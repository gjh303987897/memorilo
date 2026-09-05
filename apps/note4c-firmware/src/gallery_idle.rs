use std::time::Duration;

pub const GALLERY_AUTO_FULLSCREEN_DELAY: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GalleryIdleFullscreen {
    delay: Duration,
    due_at: Option<Duration>,
}

impl Default for GalleryIdleFullscreen {
    fn default() -> Self {
        Self::new(GALLERY_AUTO_FULLSCREEN_DELAY)
    }
}

impl GalleryIdleFullscreen {
    pub const fn new(delay: Duration) -> Self {
        Self {
            delay,
            due_at: None,
        }
    }

    pub fn update(&mut self, now: Duration, eligible: bool, input_activity: bool) -> bool {
        if !eligible {
            self.due_at = None;
            return false;
        }

        if input_activity || self.due_at.is_none() {
            self.due_at = Some(now.saturating_add(self.delay));
            return false;
        }

        if self.due_at.is_some_and(|due_at| now >= due_at) {
            self.due_at = None;
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_gallery_enters_fullscreen_after_the_idle_delay() {
        let mut idle = GalleryIdleFullscreen::new(Duration::from_secs(30));

        assert!(!idle.update(Duration::from_secs(10), true, false));
        assert!(!idle.update(Duration::from_secs(39), true, false));
        assert!(idle.update(Duration::from_secs(40), true, false));
        assert!(!idle.update(Duration::from_secs(41), false, false));
    }

    #[test]
    fn input_restarts_the_delay() {
        let mut idle = GalleryIdleFullscreen::new(Duration::from_secs(30));

        assert!(!idle.update(Duration::ZERO, true, false));
        assert!(!idle.update(Duration::from_secs(20), true, true));
        assert!(!idle.update(Duration::from_secs(49), true, false));
        assert!(idle.update(Duration::from_secs(50), true, false));
    }

    #[test]
    fn leaving_normal_nonempty_gallery_cancels_the_deadline() {
        let mut idle = GalleryIdleFullscreen::new(Duration::from_secs(30));

        assert!(!idle.update(Duration::ZERO, true, false));
        assert!(!idle.update(Duration::from_secs(20), false, false));
        assert!(!idle.update(Duration::from_secs(31), true, false));
        assert!(!idle.update(Duration::from_secs(60), true, false));
        assert!(idle.update(Duration::from_secs(61), true, false));
    }
}
