use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SleepBlocker {
    Provisioning,
    Network,
    Storage,
    Audio,
    Ota,
}

impl SleepBlocker {
    const ALL: [Self; 5] = [
        Self::Provisioning,
        Self::Network,
        Self::Storage,
        Self::Audio,
        Self::Ota,
    ];

    const fn index(self) -> usize {
        match self {
            Self::Provisioning => 0,
            Self::Network => 1,
            Self::Storage => 2,
            Self::Audio => 3,
            Self::Ota => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SleepTrigger {
    Inactivity,
    Manual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AwakeReason {
    Active,
    ExternalPower,
    DisplayWork,
    PersistenceWrite,
    Lease(SleepBlocker),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SleepDecision {
    Awake(AwakeReason),
    Ready(SleepTrigger),
}

pub struct PowerCoordinator {
    idle_timeout: Duration,
    last_activity: Duration,
    manual_requested: bool,
    external_power: bool,
    display_work: bool,
    persistence_write: bool,
    lease_deadlines: [Option<Duration>; SleepBlocker::ALL.len()],
}

impl PowerCoordinator {
    pub fn new(idle_timeout: Duration, now: Duration) -> Self {
        Self {
            idle_timeout,
            last_activity: now,
            manual_requested: false,
            external_power: false,
            display_work: false,
            persistence_write: false,
            lease_deadlines: [None; SleepBlocker::ALL.len()],
        }
    }

    pub fn note_activity(&mut self, now: Duration) {
        self.last_activity = now;
        self.manual_requested = false;
    }

    pub fn request_manual_sleep(&mut self) {
        self.manual_requested = true;
    }

    pub fn set_external_power(&mut self, present: bool) {
        self.external_power = present;
    }

    pub fn set_display_work(&mut self, active: bool) {
        self.display_work = active;
    }

    pub fn set_persistence_write(&mut self, active: bool) {
        self.persistence_write = active;
    }

    pub fn acquire_lease(&mut self, blocker: SleepBlocker, now: Duration, lifetime: Duration) {
        let deadline = now.saturating_add(lifetime.min(Duration::from_secs(10 * 60)));
        self.lease_deadlines[blocker.index()] = Some(deadline);
    }

    pub fn release_lease(&mut self, blocker: SleepBlocker) {
        self.lease_deadlines[blocker.index()] = None;
    }

    pub fn poll(&mut self, now: Duration) -> SleepDecision {
        for blocker in SleepBlocker::ALL {
            if self.lease_deadlines[blocker.index()].is_some_and(|deadline| now >= deadline) {
                self.lease_deadlines[blocker.index()] = None;
            }
        }

        let trigger = if self.manual_requested {
            Some(SleepTrigger::Manual)
        } else if now.saturating_sub(self.last_activity) >= self.idle_timeout {
            Some(SleepTrigger::Inactivity)
        } else {
            None
        };
        if trigger.is_none() {
            return SleepDecision::Awake(AwakeReason::Active);
        }
        if trigger == Some(SleepTrigger::Inactivity) && self.external_power {
            return SleepDecision::Awake(AwakeReason::ExternalPower);
        }
        if self.display_work {
            return SleepDecision::Awake(AwakeReason::DisplayWork);
        }
        if self.persistence_write {
            return SleepDecision::Awake(AwakeReason::PersistenceWrite);
        }
        if let Some(blocker) = SleepBlocker::ALL
            .into_iter()
            .find(|blocker| self.lease_deadlines[blocker.index()].is_some())
        {
            return SleepDecision::Awake(AwakeReason::Lease(blocker));
        }
        SleepDecision::Ready(trigger.expect("sleep trigger was checked above"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_sleep_waits_for_display_and_persistence() {
        let mut power = PowerCoordinator::new(Duration::from_secs(60), Duration::ZERO);
        power.set_display_work(true);
        assert_eq!(
            power.poll(Duration::from_secs(60)),
            SleepDecision::Awake(AwakeReason::DisplayWork)
        );
        power.set_display_work(false);
        power.set_persistence_write(true);
        assert_eq!(
            power.poll(Duration::from_secs(61)),
            SleepDecision::Awake(AwakeReason::PersistenceWrite)
        );
        power.set_persistence_write(false);
        assert_eq!(
            power.poll(Duration::from_secs(62)),
            SleepDecision::Ready(SleepTrigger::Inactivity)
        );
    }

    #[test]
    fn manual_sleep_uses_the_same_safety_gates() {
        let mut power = PowerCoordinator::new(Duration::from_secs(600), Duration::ZERO);
        power.request_manual_sleep();
        power.set_display_work(true);
        assert_eq!(
            power.poll(Duration::from_secs(1)),
            SleepDecision::Awake(AwakeReason::DisplayWork)
        );
        power.set_display_work(false);
        assert_eq!(
            power.poll(Duration::from_secs(2)),
            SleepDecision::Ready(SleepTrigger::Manual)
        );
    }

    #[test]
    fn external_power_blocks_inactivity_but_not_manual_sleep() {
        let mut power = PowerCoordinator::new(Duration::from_secs(60), Duration::ZERO);
        power.set_external_power(true);
        assert_eq!(
            power.poll(Duration::from_secs(60)),
            SleepDecision::Awake(AwakeReason::ExternalPower)
        );

        power.request_manual_sleep();
        assert_eq!(
            power.poll(Duration::from_secs(61)),
            SleepDecision::Ready(SleepTrigger::Manual)
        );
    }

    #[test]
    fn activity_resets_timeout_and_cancels_a_manual_request() {
        let mut power = PowerCoordinator::new(Duration::from_secs(60), Duration::ZERO);
        power.request_manual_sleep();
        power.note_activity(Duration::from_secs(30));
        assert_eq!(
            power.poll(Duration::from_secs(60)),
            SleepDecision::Awake(AwakeReason::Active)
        );
        assert_eq!(
            power.poll(Duration::from_secs(90)),
            SleepDecision::Ready(SleepTrigger::Inactivity)
        );
    }

    #[test]
    fn failed_services_cannot_hold_an_unbounded_lease() {
        let mut power = PowerCoordinator::new(Duration::ZERO, Duration::ZERO);
        power.acquire_lease(
            SleepBlocker::Provisioning,
            Duration::ZERO,
            Duration::from_secs(60 * 60),
        );
        assert_eq!(
            power.poll(Duration::from_secs(599)),
            SleepDecision::Awake(AwakeReason::Lease(SleepBlocker::Provisioning))
        );
        assert_eq!(
            power.poll(Duration::from_secs(600)),
            SleepDecision::Ready(SleepTrigger::Inactivity)
        );
    }

    #[test]
    fn gallery_storage_lease_is_released_after_a_mutation() {
        let mut power = PowerCoordinator::new(Duration::from_secs(60), Duration::ZERO);
        power.acquire_lease(
            SleepBlocker::Storage,
            Duration::ZERO,
            Duration::from_secs(30),
        );
        power.release_lease(SleepBlocker::Storage);
        assert_eq!(
            power.poll(Duration::from_secs(60)),
            SleepDecision::Ready(SleepTrigger::Inactivity)
        );
    }
}
