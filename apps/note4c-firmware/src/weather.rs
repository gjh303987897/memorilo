use crate::glance::{WeatherCondition, WeatherReading, WeatherSnapshot};

/// Keeps the network-specific fetcher outside Application and makes refresh policy testable.
pub trait WeatherProvider {
    type Error;

    fn fetch(
        &mut self,
        latitude_e6: i32,
        longitude_e6: i32,
        now_unix_seconds: i64,
    ) -> Result<WeatherReading, Self::Error>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WeatherSchedulerEvent {
    Fetched(WeatherReading),
    Failed(String),
}

pub struct WeatherScheduler<P> {
    provider: P,
    latitude_e6: i32,
    longitude_e6: i32,
    pub snapshot: WeatherSnapshot,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DemoWeatherProvider;

impl WeatherProvider for DemoWeatherProvider {
    type Error = core::convert::Infallible;

    fn fetch(
        &mut self,
        latitude_e6: i32,
        longitude_e6: i32,
        now_unix_seconds: i64,
    ) -> Result<WeatherReading, Self::Error> {
        let location_seed = i64::from(latitude_e6).abs() + i64::from(longitude_e6).abs();
        Ok(WeatherReading {
            is_demo: true,
            observed_at_unix_seconds: now_unix_seconds,
            fetched_at_unix_seconds: now_unix_seconds,
            temperature_tenths_celsius: 180 + (location_seed % 90) as i16,
            apparent_temperature_tenths_celsius: 175 + (location_seed % 90) as i16,
            relative_humidity_percent: 58,
            precipitation_probability_percent: 20,
            condition: WeatherCondition::Cloudy,
        })
    }
}

impl<P> WeatherScheduler<P> {
    pub fn new(
        provider: P,
        latitude_e6: i32,
        longitude_e6: i32,
        cached: Option<WeatherReading>,
    ) -> Self {
        Self {
            provider,
            latitude_e6,
            longitude_e6,
            snapshot: WeatherSnapshot::from_cache(cached, None),
        }
    }

    pub fn poll(
        &mut self,
        enabled: bool,
        online: bool,
        now_unix_seconds: i64,
    ) -> Option<WeatherSchedulerEvent>
    where
        P: WeatherProvider,
        P::Error: ToString,
    {
        if !self
            .snapshot
            .should_fetch(enabled, online, now_unix_seconds)
        {
            return None;
        }
        self.snapshot.fetching();
        match self
            .provider
            .fetch(self.latitude_e6, self.longitude_e6, now_unix_seconds)
        {
            Ok(reading) => {
                self.snapshot.fetched(reading.clone());
                Some(WeatherSchedulerEvent::Fetched(reading))
            }
            Err(error) => {
                let message = error.to_string();
                self.snapshot.failed(now_unix_seconds, message.clone());
                Some(WeatherSchedulerEvent::Failed(message))
            }
        }
    }

    pub fn set_location(&mut self, latitude_e6: i32, longitude_e6: i32) {
        if self.latitude_e6 != latitude_e6 || self.longitude_e6 != longitude_e6 {
            self.latitude_e6 = latitude_e6;
            self.longitude_e6 = longitude_e6;
            self.snapshot = WeatherSnapshot::default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glance::{WEATHER_REFRESH_SECONDS, WEATHER_RETRY_SECONDS, WeatherCondition};

    struct FakeProvider {
        result: Result<WeatherReading, &'static str>,
    }

    impl WeatherProvider for FakeProvider {
        type Error = &'static str;

        fn fetch(&mut self, _: i32, _: i32, now: i64) -> Result<WeatherReading, Self::Error> {
            self.result.clone().map(|mut reading| {
                reading.fetched_at_unix_seconds = now;
                reading
            })
        }
    }

    fn reading() -> WeatherReading {
        WeatherReading {
            is_demo: false,
            observed_at_unix_seconds: 1,
            fetched_at_unix_seconds: 1,
            temperature_tenths_celsius: 210,
            apparent_temperature_tenths_celsius: 205,
            relative_humidity_percent: 50,
            precipitation_probability_percent: 10,
            condition: WeatherCondition::Clear,
        }
    }

    #[test]
    fn scheduler_fetches_once_per_hour_and_retries_failures_with_backoff() {
        let mut scheduler = WeatherScheduler::new(
            FakeProvider {
                result: Ok(reading()),
            },
            1,
            2,
            None,
        );
        assert!(matches!(
            scheduler.poll(true, true, 100),
            Some(WeatherSchedulerEvent::Fetched(_))
        ));
        assert!(
            scheduler
                .poll(true, true, 100 + WEATHER_REFRESH_SECONDS - 1)
                .is_none()
        );
        assert!(
            scheduler
                .poll(true, true, 100 + WEATHER_REFRESH_SECONDS)
                .is_some()
        );

        let mut failed = WeatherScheduler::new(
            FakeProvider {
                result: Err("offline"),
            },
            1,
            2,
            None,
        );
        assert!(matches!(
            failed.poll(true, true, 100),
            Some(WeatherSchedulerEvent::Failed(_))
        ));
        assert!(
            failed
                .poll(true, true, 100 + WEATHER_RETRY_SECONDS - 1)
                .is_none()
        );
    }

    #[test]
    fn changing_location_discards_the_old_cache_and_fetches_immediately() {
        let mut scheduler = WeatherScheduler::new(
            FakeProvider {
                result: Ok(reading()),
            },
            1,
            2,
            Some(reading()),
        );

        scheduler.set_location(3, 4);

        assert!(scheduler.snapshot.reading.is_none());
        assert!(scheduler.snapshot.next_fetch_at_unix_seconds.is_none());
        assert!(matches!(
            scheduler.poll(true, true, 100),
            Some(WeatherSchedulerEvent::Fetched(_))
        ));
    }
}
