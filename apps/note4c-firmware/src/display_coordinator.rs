use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use crate::framebuffer::{FRAME_BYTES, HEIGHT, WIDTH};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DirtyRect {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FrameDelta {
    pub changed_bytes: usize,
    pub changed_pixels: usize,
    pub change_ratio_permyriad: u16,
    pub dirty_rect: Option<DirtyRect>,
}

impl FrameDelta {
    pub fn between(previous: Option<&[u8]>, next: &[u8]) -> Self {
        if previous.is_none() {
            return Self {
                changed_bytes: FRAME_BYTES,
                changed_pixels: WIDTH * HEIGHT,
                change_ratio_permyriad: 10_000,
                dirty_rect: Some(DirtyRect {
                    x: 0,
                    y: 0,
                    width: WIDTH,
                    height: HEIGHT,
                }),
            };
        }

        let previous = previous.expect("previous frame was checked above");
        let mut changed_bytes = 0;
        let mut changed_pixels = 0;
        let mut min_x = WIDTH;
        let mut min_y = HEIGHT;
        let mut max_x = 0;
        let mut max_y = 0;

        for (byte_index, (&before, &after)) in previous.iter().zip(next).enumerate() {
            if before == after {
                continue;
            }
            changed_bytes += 1;
            for pixel_in_byte in 0..4 {
                let shift = 6 - pixel_in_byte * 2;
                if ((before >> shift) & 0b11) == ((after >> shift) & 0b11) {
                    continue;
                }
                changed_pixels += 1;
                let pixel = byte_index * 4 + pixel_in_byte;
                let x = pixel % WIDTH;
                let y = pixel / WIDTH;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }

        Self {
            changed_bytes,
            changed_pixels,
            change_ratio_permyriad: ((changed_pixels * 10_000) / (WIDTH * HEIGHT)) as u16,
            dirty_rect: (changed_pixels != 0).then(|| DirtyRect {
                x: min_x,
                y: min_y,
                width: max_x - min_x + 1,
                height: max_y - min_y + 1,
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DisplayPolicy {
    pub small_change_max_pixels: usize,
    pub debounce: Duration,
    pub maximum_delay: Duration,
}

impl Default for DisplayPolicy {
    fn default() -> Self {
        Self {
            small_change_max_pixels: 1_200,
            debounce: Duration::from_millis(350),
            maximum_delay: Duration::from_millis(1_000),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayEvent {
    Busy {
        revision: u64,
        delta: FrameDelta,
    },
    Completed {
        revision: u64,
    },
    Skipped {
        revision: u64,
    },
    Delayed {
        revision: u64,
        ready_at: Duration,
        delta: FrameDelta,
    },
    Failed {
        revision: u64,
    },
}

#[derive(Clone)]
struct Frame {
    revision: u64,
    pixels: Arc<[u8]>,
}

impl Frame {
    fn same_pixels(&self, other: &Self) -> bool {
        self.pixels == other.pixels
    }
}

#[derive(Clone)]
pub struct RefreshRequest {
    pub revision: u64,
    pub delta: FrameDelta,
    pixels: Arc<[u8]>,
}

impl RefreshRequest {
    pub fn framebuffer(&self) -> &[u8] {
        &self.pixels
    }
}

#[derive(Default)]
pub struct CoordinatorOutput {
    pub refresh: Option<RefreshRequest>,
    pub events: Vec<DisplayEvent>,
}

#[derive(Debug, Eq, PartialEq)]
pub enum CoordinatorError {
    InvalidFrameSize { actual: usize },
    NoRefreshInFlight,
    UnexpectedCompletion { expected: u64, actual: u64 },
}

impl fmt::Display for CoordinatorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFrameSize { actual } => {
                write!(
                    formatter,
                    "invalid framebuffer size: expected {FRAME_BYTES}, got {actual}"
                )
            }
            Self::NoRefreshInFlight => write!(formatter, "display completion without a refresh"),
            Self::UnexpectedCompletion { expected, actual } => write!(
                formatter,
                "display completion revision mismatch: expected {expected}, got {actual}"
            ),
        }
    }
}

impl std::error::Error for CoordinatorError {}

struct PendingFrame {
    frame: Frame,
    first_requested_at: Duration,
    ready_at: Duration,
}

pub struct DisplayCoordinator {
    policy: DisplayPolicy,
    last_displayed: Option<Frame>,
    in_flight: Option<Frame>,
    pending: Option<PendingFrame>,
}

impl DisplayCoordinator {
    pub fn new(policy: DisplayPolicy) -> Self {
        Self {
            policy,
            last_displayed: None,
            in_flight: None,
            pending: None,
        }
    }

    pub fn request(
        &mut self,
        revision: u64,
        framebuffer: Vec<u8>,
        now: Duration,
    ) -> Result<CoordinatorOutput, CoordinatorError> {
        if framebuffer.len() != FRAME_BYTES {
            return Err(CoordinatorError::InvalidFrameSize {
                actual: framebuffer.len(),
            });
        }
        let frame = Frame {
            revision,
            pixels: framebuffer.into(),
        };

        if let Some(pending) = &mut self.pending
            && pending.frame.same_pixels(&frame)
        {
            pending.frame.revision = revision;
            return Ok(CoordinatorOutput {
                refresh: None,
                events: vec![DisplayEvent::Skipped { revision }],
            });
        }

        if self.in_flight.is_some() {
            return Ok(self.queue_pending(frame, now));
        }

        if let Some(displayed) = &mut self.last_displayed
            && displayed.same_pixels(&frame)
        {
            displayed.revision = revision;
            return Ok(CoordinatorOutput {
                refresh: None,
                events: vec![DisplayEvent::Skipped { revision }],
            });
        }

        let delta = FrameDelta::between(
            self.last_displayed
                .as_ref()
                .map(|displayed| displayed.pixels.as_ref()),
            &frame.pixels,
        );
        if self.last_displayed.is_some()
            && delta.changed_pixels <= self.policy.small_change_max_pixels
        {
            Ok(self.queue_pending(frame, now))
        } else {
            Ok(self.start_refresh(frame, delta))
        }
    }

    pub fn poll(&mut self, now: Duration) -> CoordinatorOutput {
        if self.in_flight.is_some() || self.pending.as_ref().is_none_or(|p| now < p.ready_at) {
            return CoordinatorOutput::default();
        }
        self.start_pending(now)
    }

    pub fn complete(
        &mut self,
        revision: u64,
        succeeded: bool,
        now: Duration,
    ) -> Result<CoordinatorOutput, CoordinatorError> {
        let Some(in_flight) = self.in_flight.take() else {
            return Err(CoordinatorError::NoRefreshInFlight);
        };
        if in_flight.revision != revision {
            let expected = in_flight.revision;
            self.in_flight = Some(in_flight);
            return Err(CoordinatorError::UnexpectedCompletion {
                expected,
                actual: revision,
            });
        }

        let mut output = CoordinatorOutput::default();
        if succeeded {
            self.last_displayed = Some(in_flight);
            output.events.push(DisplayEvent::Completed { revision });
        } else {
            output.events.push(DisplayEvent::Failed { revision });
        }

        let successor = self.start_pending(now);
        output.events.extend(successor.events);
        output.refresh = successor.refresh;
        Ok(output)
    }

    pub fn displayed_revision(&self) -> Option<u64> {
        self.last_displayed.as_ref().map(|frame| frame.revision)
    }

    pub fn has_pending_work(&self) -> bool {
        self.in_flight.is_some() || self.pending.is_some()
    }

    fn queue_pending(&mut self, frame: Frame, now: Duration) -> CoordinatorOutput {
        let first_requested_at = self
            .pending
            .as_ref()
            .map_or(now, |pending| pending.first_requested_at);
        let base = self.in_flight.as_ref().or(self.last_displayed.as_ref());
        let delta = FrameDelta::between(base.map(|frame| frame.pixels.as_ref()), &frame.pixels);
        let ready_at = if delta.changed_pixels > self.policy.small_change_max_pixels {
            now
        } else {
            (now + self.policy.debounce).min(first_requested_at + self.policy.maximum_delay)
        };
        let revision = frame.revision;
        self.pending = Some(PendingFrame {
            frame,
            first_requested_at,
            ready_at,
        });
        CoordinatorOutput {
            refresh: None,
            events: vec![DisplayEvent::Delayed {
                revision,
                ready_at,
                delta,
            }],
        }
    }

    fn start_pending(&mut self, now: Duration) -> CoordinatorOutput {
        let Some(pending) = self.pending.take() else {
            return CoordinatorOutput::default();
        };
        if now < pending.ready_at {
            self.pending = Some(pending);
            return CoordinatorOutput::default();
        }

        if let Some(displayed) = &mut self.last_displayed
            && displayed.same_pixels(&pending.frame)
        {
            displayed.revision = pending.frame.revision;
            return CoordinatorOutput {
                refresh: None,
                events: vec![DisplayEvent::Skipped {
                    revision: pending.frame.revision,
                }],
            };
        }

        let delta = FrameDelta::between(
            self.last_displayed
                .as_ref()
                .map(|displayed| displayed.pixels.as_ref()),
            &pending.frame.pixels,
        );
        self.start_refresh(pending.frame, delta)
    }

    fn start_refresh(&mut self, frame: Frame, delta: FrameDelta) -> CoordinatorOutput {
        let request = RefreshRequest {
            revision: frame.revision,
            delta,
            pixels: Arc::clone(&frame.pixels),
        };
        self.in_flight = Some(frame);
        CoordinatorOutput {
            refresh: Some(request.clone()),
            events: vec![DisplayEvent::Busy {
                revision: request.revision,
                delta,
            }],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(fill: u8) -> Vec<u8> {
        vec![fill; FRAME_BYTES]
    }

    fn complete_first_frame(coordinator: &mut DisplayCoordinator, pixels: Vec<u8>) {
        let output = coordinator
            .request(1, pixels, Duration::ZERO)
            .expect("first frame should be valid");
        assert_eq!(output.refresh.unwrap().revision, 1);
        coordinator
            .complete(1, true, Duration::from_secs(25))
            .expect("first refresh should complete");
    }

    #[test]
    fn calculates_changed_pixels_and_bounds_in_packed_frames() {
        let before = frame(0x55);
        let mut after = before.clone();
        let first_pixel = 10 * WIDTH + 7;
        let second_pixel = 12 * WIDTH + 9;
        for pixel in [first_pixel, second_pixel] {
            let byte = pixel / 4;
            let shift = 6 - (pixel % 4) * 2;
            after[byte] &= !(0b11 << shift);
        }

        let delta = FrameDelta::between(Some(&before), &after);

        assert_eq!(delta.changed_bytes, 2);
        assert_eq!(delta.changed_pixels, 2);
        assert_eq!(
            delta.dirty_rect,
            Some(DirtyRect {
                x: 7,
                y: 10,
                width: 3,
                height: 3,
            })
        );
    }

    #[test]
    fn identical_frames_skip_the_physical_display() {
        let mut coordinator = DisplayCoordinator::new(DisplayPolicy::default());
        complete_first_frame(&mut coordinator, frame(0x55));

        let output = coordinator
            .request(2, frame(0x55), Duration::from_secs(26))
            .unwrap();

        assert!(output.refresh.is_none());
        assert_eq!(output.events, vec![DisplayEvent::Skipped { revision: 2 }]);
        assert_eq!(coordinator.displayed_revision(), Some(2));
    }

    #[test]
    fn small_changes_are_delayed_and_merged_with_bounded_latency() {
        let policy = DisplayPolicy {
            small_change_max_pixels: 10,
            debounce: Duration::from_millis(300),
            maximum_delay: Duration::from_millis(500),
        };
        let mut coordinator = DisplayCoordinator::new(policy);
        let baseline = frame(0x55);
        complete_first_frame(&mut coordinator, baseline.clone());

        let mut second = baseline.clone();
        second[0] = 0x15;
        let first = coordinator
            .request(2, second, Duration::from_secs(26))
            .unwrap();
        assert!(first.refresh.is_none());

        let mut latest = baseline;
        latest[1] = 0x15;
        let merged = coordinator
            .request(3, latest.clone(), Duration::from_millis(26_250))
            .unwrap();
        assert!(merged.refresh.is_none());
        assert!(
            coordinator
                .poll(Duration::from_millis(26_499))
                .refresh
                .is_none()
        );

        let due = coordinator.poll(Duration::from_millis(26_500));
        let refresh = due.refresh.expect("merged frame should become due");
        assert_eq!(refresh.revision, 3);
        assert_eq!(refresh.framebuffer(), latest);
    }

    #[test]
    fn updates_during_refresh_coalesce_to_the_latest_successor() {
        let mut coordinator = DisplayCoordinator::new(DisplayPolicy {
            small_change_max_pixels: 0,
            ..DisplayPolicy::default()
        });
        let first = frame(0x55);
        let second = frame(0xaa);
        let latest = frame(0xff);

        assert_eq!(
            coordinator
                .request(1, first, Duration::ZERO)
                .unwrap()
                .refresh
                .unwrap()
                .revision,
            1
        );
        coordinator
            .request(2, second, Duration::from_millis(20))
            .unwrap();
        coordinator
            .request(3, latest.clone(), Duration::from_millis(40))
            .unwrap();

        let completed = coordinator
            .complete(1, true, Duration::from_secs(25))
            .unwrap();
        assert_eq!(coordinator.displayed_revision(), Some(1));
        let successor = completed.refresh.expect("latest successor should start");
        assert_eq!(successor.revision, 3);
        assert_eq!(successor.framebuffer(), latest);
    }

    #[test]
    fn stale_completion_does_not_replace_the_in_flight_frame() {
        let mut coordinator = DisplayCoordinator::new(DisplayPolicy::default());
        coordinator.request(7, frame(0x55), Duration::ZERO).unwrap();

        assert!(matches!(
            coordinator.complete(6, true, Duration::from_secs(1)),
            Err(CoordinatorError::UnexpectedCompletion {
                expected: 7,
                actual: 6,
            })
        ));
        assert_eq!(coordinator.displayed_revision(), None);
        coordinator
            .complete(7, true, Duration::from_secs(25))
            .unwrap();
        assert_eq!(coordinator.displayed_revision(), Some(7));
    }
}
