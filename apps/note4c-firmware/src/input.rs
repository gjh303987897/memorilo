use std::time::Duration;

use crate::application::{ApplicationCommand, PageId};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ButtonId {
    Up,
    Ok,
    Down,
}

impl ButtonId {
    const ALL: [Self; 3] = [Self::Up, Self::Ok, Self::Down];

    const fn index(self) -> usize {
        match self {
            Self::Up => 0,
            Self::Ok => 1,
            Self::Down => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ButtonState {
    pub up: bool,
    pub ok: bool,
    pub down: bool,
}

impl ButtonState {
    fn pressed(self, button: ButtonId) -> bool {
        match button {
            ButtonId::Up => self.up,
            ButtonId::Ok => self.ok,
            ButtonId::Down => self.down,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Gesture {
    Press(ButtonId),
    Release(ButtonId),
    Tap(ButtonId),
    LongPress(ButtonId),
    Repeat(ButtonId),
    UpDownChordLongPress,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GestureTiming {
    pub debounce: Duration,
    pub long_press: Duration,
    pub repeat_delay: Duration,
    pub repeat_interval: Duration,
    pub chord_long_press: Duration,
}

impl Default for GestureTiming {
    fn default() -> Self {
        Self {
            debounce: Duration::from_millis(35),
            long_press: Duration::from_millis(700),
            repeat_delay: Duration::from_millis(500),
            repeat_interval: Duration::from_millis(180),
            chord_long_press: Duration::from_millis(900),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct ButtonTracker {
    raw_pressed: bool,
    stable_pressed: bool,
    raw_changed_at: Duration,
    pressed_at: Duration,
    last_repeat_at: Duration,
    long_emitted: bool,
    repeated: bool,
    consumed: bool,
}

impl Default for ButtonTracker {
    fn default() -> Self {
        Self {
            raw_pressed: false,
            stable_pressed: false,
            raw_changed_at: Duration::ZERO,
            pressed_at: Duration::ZERO,
            last_repeat_at: Duration::ZERO,
            long_emitted: false,
            repeated: false,
            consumed: false,
        }
    }
}

pub struct GestureRecognizer {
    timing: GestureTiming,
    buttons: [ButtonTracker; ButtonId::ALL.len()],
    chord_started_at: Option<Duration>,
    chord_emitted: bool,
}

impl Default for GestureRecognizer {
    fn default() -> Self {
        Self::new(GestureTiming::default())
    }
}

impl GestureRecognizer {
    pub fn new(timing: GestureTiming) -> Self {
        Self {
            timing,
            buttons: [ButtonTracker::default(); ButtonId::ALL.len()],
            chord_started_at: None,
            chord_emitted: false,
        }
    }

    pub fn update(&mut self, now: Duration, state: ButtonState) -> Vec<Gesture> {
        let mut gestures = Vec::new();
        for button in ButtonId::ALL {
            let tracker = &mut self.buttons[button.index()];
            let raw_pressed = state.pressed(button);
            if raw_pressed != tracker.raw_pressed {
                tracker.raw_pressed = raw_pressed;
                tracker.raw_changed_at = now;
            }
            if raw_pressed == tracker.stable_pressed
                || now.saturating_sub(tracker.raw_changed_at) < self.timing.debounce
            {
                continue;
            }

            tracker.stable_pressed = raw_pressed;
            if raw_pressed {
                tracker.pressed_at = now;
                tracker.last_repeat_at = now;
                tracker.long_emitted = false;
                tracker.repeated = false;
                tracker.consumed = false;
                gestures.push(Gesture::Press(button));
            } else {
                gestures.push(Gesture::Release(button));
                if !tracker.consumed && !tracker.long_emitted && !tracker.repeated {
                    gestures.push(Gesture::Tap(button));
                }
            }
        }

        let up_pressed = self.buttons[ButtonId::Up.index()].stable_pressed;
        let down_pressed = self.buttons[ButtonId::Down.index()].stable_pressed;
        if up_pressed && down_pressed {
            if self.chord_started_at.is_none() {
                self.chord_started_at = Some(now);
                self.chord_emitted = false;
                self.buttons[ButtonId::Up.index()].consumed = true;
                self.buttons[ButtonId::Down.index()].consumed = true;
            }
            if !self.chord_emitted
                && now.saturating_sub(self.chord_started_at.unwrap())
                    >= self.timing.chord_long_press
            {
                self.chord_emitted = true;
                gestures.push(Gesture::UpDownChordLongPress);
            }
        } else if self.chord_started_at.is_some() {
            self.chord_started_at = None;
            self.chord_emitted = false;
        }

        for button in ButtonId::ALL {
            if matches!(button, ButtonId::Up | ButtonId::Down) && self.chord_started_at.is_some() {
                continue;
            }
            let tracker = &mut self.buttons[button.index()];
            if !tracker.stable_pressed {
                continue;
            }

            let held_for = now.saturating_sub(tracker.pressed_at);
            if !tracker.long_emitted && held_for >= self.timing.long_press {
                tracker.long_emitted = true;
                tracker.consumed = true;
                gestures.push(Gesture::LongPress(button));
            }
            if matches!(button, ButtonId::Up | ButtonId::Down)
                && held_for >= self.timing.repeat_delay
                && (!tracker.repeated
                    || now.saturating_sub(tracker.last_repeat_at) >= self.timing.repeat_interval)
            {
                tracker.repeated = true;
                tracker.consumed = true;
                tracker.last_repeat_at = now;
                gestures.push(Gesture::Repeat(button));
            }
        }

        gestures
    }
}

pub fn route_gesture(page: PageId, gesture: Gesture) -> Option<ApplicationCommand> {
    match (page, gesture) {
        (PageId::Todos, Gesture::Tap(ButtonId::Up)) => Some(ApplicationCommand::SelectPrevious),
        (PageId::Todos, Gesture::Tap(ButtonId::Down)) => Some(ApplicationCommand::SelectNext),
        (PageId::Gallery | PageId::Calendar, Gesture::Tap(ButtonId::Up)) => {
            Some(ApplicationCommand::SelectPrevious)
        }
        (PageId::Gallery | PageId::Calendar, Gesture::Tap(ButtonId::Down)) => {
            Some(ApplicationCommand::SelectNext)
        }
        (PageId::Gallery | PageId::Calendar | PageId::Diagnostics, Gesture::Tap(ButtonId::Ok)) => {
            Some(ApplicationCommand::ActivateSelection)
        }
        (PageId::Provisioning, Gesture::LongPress(ButtonId::Ok)) => {
            Some(ApplicationCommand::EnterProvisioning)
        }
        (_, Gesture::LongPress(ButtonId::Up)) => Some(ApplicationCommand::PreviousPage),
        (_, Gesture::LongPress(ButtonId::Down)) => Some(ApplicationCommand::NextPage),
        (_, Gesture::UpDownChordLongPress) => Some(ApplicationCommand::EnterProvisioning),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timing() -> GestureTiming {
        GestureTiming {
            debounce: Duration::from_millis(20),
            long_press: Duration::from_millis(500),
            repeat_delay: Duration::from_millis(300),
            repeat_interval: Duration::from_millis(100),
            chord_long_press: Duration::from_millis(700),
        }
    }

    #[test]
    fn tap_emits_press_release_and_one_tap_after_debounce() {
        let mut recognizer = GestureRecognizer::new(timing());
        assert!(
            recognizer
                .update(
                    Duration::ZERO,
                    ButtonState {
                        up: true,
                        ..Default::default()
                    }
                )
                .is_empty()
        );
        assert_eq!(
            recognizer.update(
                Duration::from_millis(20),
                ButtonState {
                    up: true,
                    ..Default::default()
                }
            ),
            vec![Gesture::Press(ButtonId::Up)]
        );
        recognizer.update(Duration::from_millis(40), ButtonState::default());
        assert_eq!(
            recognizer.update(Duration::from_millis(60), ButtonState::default()),
            vec![Gesture::Release(ButtonId::Up), Gesture::Tap(ButtonId::Up)]
        );
    }

    #[test]
    fn held_navigation_repeats_without_emitting_a_tap_on_release() {
        let mut recognizer = GestureRecognizer::new(timing());
        let held = ButtonState {
            down: true,
            ..Default::default()
        };
        recognizer.update(Duration::ZERO, held);
        recognizer.update(Duration::from_millis(20), held);
        assert_eq!(
            recognizer.update(Duration::from_millis(320), held),
            vec![Gesture::Repeat(ButtonId::Down)]
        );
        assert_eq!(
            recognizer.update(Duration::from_millis(420), held),
            vec![Gesture::Repeat(ButtonId::Down)]
        );
        recognizer.update(Duration::from_millis(440), ButtonState::default());
        assert_eq!(
            recognizer.update(Duration::from_millis(460), ButtonState::default()),
            vec![Gesture::Release(ButtonId::Down)]
        );
    }

    #[test]
    fn chord_has_precedence_over_individual_taps_and_long_presses() {
        let mut recognizer = GestureRecognizer::new(timing());
        let chord = ButtonState {
            up: true,
            down: true,
            ok: false,
        };
        recognizer.update(Duration::ZERO, chord);
        assert_eq!(
            recognizer.update(Duration::from_millis(20), chord),
            vec![Gesture::Press(ButtonId::Up), Gesture::Press(ButtonId::Down)]
        );
        assert_eq!(
            recognizer.update(Duration::from_millis(720), chord),
            vec![Gesture::UpDownChordLongPress]
        );
        recognizer.update(Duration::from_millis(740), ButtonState::default());
        assert_eq!(
            recognizer.update(Duration::from_millis(760), ButtonState::default()),
            vec![
                Gesture::Release(ButtonId::Up),
                Gesture::Release(ButtonId::Down)
            ]
        );
    }

    #[test]
    fn command_routing_avoids_double_click_delay() {
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::Tap(ButtonId::Ok)),
            None
        );
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::Tap(ButtonId::Down)),
            Some(ApplicationCommand::SelectNext)
        );
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::Tap(ButtonId::Up)),
            Some(ApplicationCommand::SelectPrevious)
        );
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::LongPress(ButtonId::Down)),
            Some(ApplicationCommand::NextPage)
        );
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::LongPress(ButtonId::Up)),
            Some(ApplicationCommand::PreviousPage)
        );
        assert_eq!(
            route_gesture(PageId::Provisioning, Gesture::UpDownChordLongPress),
            Some(ApplicationCommand::EnterProvisioning)
        );
        assert_eq!(
            route_gesture(PageId::Provisioning, Gesture::LongPress(ButtonId::Ok)),
            Some(ApplicationCommand::EnterProvisioning)
        );
        assert_eq!(
            route_gesture(PageId::Diagnostics, Gesture::Tap(ButtonId::Ok)),
            Some(ApplicationCommand::ActivateSelection)
        );
        assert_eq!(
            route_gesture(PageId::Gallery, Gesture::Tap(ButtonId::Ok)),
            Some(ApplicationCommand::ActivateSelection)
        );
        assert_eq!(
            route_gesture(PageId::Gallery, Gesture::Tap(ButtonId::Up)),
            Some(ApplicationCommand::SelectPrevious)
        );
        assert_eq!(
            route_gesture(PageId::Gallery, Gesture::Tap(ButtonId::Down)),
            Some(ApplicationCommand::SelectNext)
        );
        assert_eq!(
            route_gesture(PageId::Todos, Gesture::Repeat(ButtonId::Down)),
            None
        );
    }
}
