use serde::{Deserialize, Serialize};

pub const WEATHER_REFRESH_SECONDS: i64 = 60 * 60;
pub const WEATHER_STALE_SECONDS: i64 = 3 * 60 * 60;
pub const WEATHER_RETRY_SECONDS: i64 = 15 * 60;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GregorianDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WeatherCondition {
    Clear,
    Cloudy,
    Fog,
    Rain,
    Snow,
    Thunderstorm,
    Unknown,
}

impl WeatherCondition {
    pub const fn from_wmo_code(code: u8) -> Self {
        match code {
            0 => Self::Clear,
            1..=3 => Self::Cloudy,
            45 | 48 => Self::Fog,
            51..=67 | 80..=82 => Self::Rain,
            71..=77 | 85 | 86 => Self::Snow,
            95..=99 => Self::Thunderstorm,
            _ => Self::Unknown,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct WeatherReading {
    pub is_demo: bool,
    pub observed_at_unix_seconds: i64,
    pub fetched_at_unix_seconds: i64,
    pub temperature_tenths_celsius: i16,
    pub apparent_temperature_tenths_celsius: i16,
    pub relative_humidity_percent: u8,
    pub precipitation_probability_percent: u8,
    pub condition: WeatherCondition,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WeatherPhase {
    Disabled,
    Unavailable,
    Loading,
    Fresh,
    Stale,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeatherSnapshot {
    pub phase: WeatherPhase,
    pub reading: Option<WeatherReading>,
    pub last_error: Option<String>,
    pub next_fetch_at_unix_seconds: Option<i64>,
}

impl Default for WeatherSnapshot {
    fn default() -> Self {
        Self {
            phase: WeatherPhase::Unavailable,
            reading: None,
            last_error: None,
            next_fetch_at_unix_seconds: None,
        }
    }
}

impl WeatherSnapshot {
    pub fn from_cache(reading: Option<WeatherReading>, now_unix_seconds: Option<i64>) -> Self {
        let mut snapshot = Self {
            reading,
            ..Self::default()
        };
        snapshot.reclassify(now_unix_seconds);
        snapshot
    }

    pub fn set_enabled(&mut self, enabled: bool, now_unix_seconds: Option<i64>) {
        if !enabled {
            self.phase = WeatherPhase::Disabled;
            self.last_error = None;
            self.next_fetch_at_unix_seconds = None;
        } else {
            self.reclassify(now_unix_seconds);
        }
    }

    pub fn should_fetch(&self, enabled: bool, online: bool, now_unix_seconds: i64) -> bool {
        enabled
            && online
            && self.phase != WeatherPhase::Loading
            && self
                .next_fetch_at_unix_seconds
                .is_none_or(|next| now_unix_seconds >= next)
    }

    pub fn fetching(&mut self) {
        self.phase = WeatherPhase::Loading;
        self.last_error = None;
    }

    pub fn fetched(&mut self, reading: WeatherReading) {
        self.next_fetch_at_unix_seconds = Some(
            reading
                .fetched_at_unix_seconds
                .saturating_add(WEATHER_REFRESH_SECONDS),
        );
        self.reading = Some(reading);
        self.last_error = None;
        self.phase = WeatherPhase::Fresh;
    }

    pub fn failed(&mut self, now_unix_seconds: i64, error: impl Into<String>) {
        self.next_fetch_at_unix_seconds =
            Some(now_unix_seconds.saturating_add(WEATHER_RETRY_SECONDS));
        self.last_error = Some(error.into());
        self.phase = if self.reading.is_some() {
            WeatherPhase::Stale
        } else {
            WeatherPhase::Failed
        };
    }

    pub fn reclassify(&mut self, now_unix_seconds: Option<i64>) {
        let Some(reading) = self.reading.as_ref() else {
            self.phase = WeatherPhase::Unavailable;
            self.next_fetch_at_unix_seconds = None;
            return;
        };
        self.next_fetch_at_unix_seconds = Some(
            reading
                .fetched_at_unix_seconds
                .saturating_add(WEATHER_REFRESH_SECONDS),
        );
        self.phase = match now_unix_seconds {
            Some(now)
                if now.saturating_sub(reading.fetched_at_unix_seconds) > WEATHER_STALE_SECONDS =>
            {
                WeatherPhase::Stale
            }
            Some(_) => WeatherPhase::Fresh,
            None => WeatherPhase::Stale,
        };
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CalendarMonth {
    pub year: i32,
    pub month: u8,
    pub days: u8,
    pub first_weekday_monday_zero: u8,
}

impl GregorianDate {
    pub fn new(year: i32, month: u8, day: u8) -> Option<Self> {
        if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
            return None;
        }
        Some(Self { year, month, day })
    }

    pub fn shifted_month(self, offset: i16) -> Self {
        let absolute_month =
            i64::from(self.year) * 12 + i64::from(self.month - 1) + i64::from(offset);
        let year = absolute_month.div_euclid(12) as i32;
        let month = absolute_month.rem_euclid(12) as u8 + 1;
        Self {
            year,
            month,
            day: self.day.min(days_in_month(year, month)),
        }
    }

    pub fn day_of_year(self) -> u16 {
        (1..self.month)
            .map(|month| u16::from(days_in_month(self.year, month)))
            .sum::<u16>()
            + u16::from(self.day)
    }

    pub fn year_progress_basis_points(self) -> u16 {
        let days = if is_leap_year(self.year) { 366 } else { 365 };
        (((u32::from(self.day_of_year()) - 1) * 10_000) / days) as u16
    }
}

pub fn calendar_month(date: GregorianDate) -> CalendarMonth {
    CalendarMonth {
        year: date.year,
        month: date.month,
        days: days_in_month(date.year, date.month),
        first_weekday_monday_zero: weekday_monday_zero(date.year, date.month, 1),
    }
}

pub const fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

pub const fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

pub fn local_date_at_unix(unix_seconds: i64, utc_offset_minutes: i16) -> GregorianDate {
    let local_seconds = unix_seconds.saturating_add(i64::from(utc_offset_minutes) * 60);
    civil_from_days(local_seconds.div_euclid(86_400))
}

fn weekday_monday_zero(year: i32, month: u8, day: u8) -> u8 {
    let days = days_from_civil(year, month, day);
    (days + 3).rem_euclid(7) as u8
}

fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let adjusted_year = i64::from(year) - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> GregorianDate {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    GregorianDate {
        year: year as i32,
        month: month as u8,
        day: day as u8,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leap_year_and_month_navigation_follow_gregorian_rules() {
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2024));
        let leap_day = GregorianDate::new(2024, 2, 29).unwrap();
        assert_eq!(
            leap_day.shifted_month(12),
            GregorianDate::new(2025, 2, 28).unwrap()
        );
        assert_eq!(
            leap_day.shifted_month(-2),
            GregorianDate::new(2023, 12, 29).unwrap()
        );
    }

    #[test]
    fn calendar_weekdays_and_annual_progress_are_deterministic() {
        let january = calendar_month(GregorianDate::new(2024, 1, 1).unwrap());
        assert_eq!(january.first_weekday_monday_zero, 0);
        assert_eq!(january.days, 31);
        let final_day = GregorianDate::new(2024, 12, 31).unwrap();
        assert_eq!(final_day.day_of_year(), 366);
        assert!(final_day.year_progress_basis_points() > 9_900);
    }

    #[test]
    fn timezone_offsets_cross_date_and_year_boundaries_without_truncation() {
        let final_utc_hour_of_2023 = 1_704_067_200_i64;
        assert_eq!(
            local_date_at_unix(final_utc_hour_of_2023, 480),
            GregorianDate::new(2024, 1, 1).unwrap()
        );
        assert_eq!(
            local_date_at_unix(0, -60),
            GregorianDate::new(1969, 12, 31).unwrap()
        );
    }

    #[test]
    fn weather_cache_is_hourly_and_keeps_stale_data_after_failures() {
        let reading = WeatherReading {
            is_demo: false,
            observed_at_unix_seconds: 1_000,
            fetched_at_unix_seconds: 1_020,
            temperature_tenths_celsius: 235,
            apparent_temperature_tenths_celsius: 228,
            relative_humidity_percent: 63,
            precipitation_probability_percent: 20,
            condition: WeatherCondition::Cloudy,
        };
        let mut weather = WeatherSnapshot::from_cache(Some(reading.clone()), Some(1_020));
        assert_eq!(weather.phase, WeatherPhase::Fresh);
        assert!(!weather.should_fetch(true, true, 1_020 + WEATHER_REFRESH_SECONDS - 1));
        assert!(weather.should_fetch(true, true, 1_020 + WEATHER_REFRESH_SECONDS));

        weather.failed(1_020 + WEATHER_REFRESH_SECONDS, "offline");
        assert_eq!(weather.phase, WeatherPhase::Stale);
        assert_eq!(weather.reading, Some(reading));
        assert!(!weather.should_fetch(
            true,
            true,
            1_020 + WEATHER_REFRESH_SECONDS + WEATHER_RETRY_SECONDS - 1
        ));
    }

    #[test]
    fn cached_weather_without_a_trusted_clock_is_explicitly_stale() {
        let reading = WeatherReading {
            is_demo: false,
            observed_at_unix_seconds: 1,
            fetched_at_unix_seconds: 2,
            temperature_tenths_celsius: 0,
            apparent_temperature_tenths_celsius: 0,
            relative_humidity_percent: 0,
            precipitation_probability_percent: 0,
            condition: WeatherCondition::Unknown,
        };
        assert_eq!(
            WeatherSnapshot::from_cache(Some(reading), None).phase,
            WeatherPhase::Stale
        );
    }

    #[test]
    fn wmo_codes_are_collapsed_to_bounded_display_conditions() {
        assert_eq!(WeatherCondition::from_wmo_code(0), WeatherCondition::Clear);
        assert_eq!(WeatherCondition::from_wmo_code(48), WeatherCondition::Fog);
        assert_eq!(WeatherCondition::from_wmo_code(82), WeatherCondition::Rain);
        assert_eq!(WeatherCondition::from_wmo_code(86), WeatherCondition::Snow);
        assert_eq!(
            WeatherCondition::from_wmo_code(95),
            WeatherCondition::Thunderstorm
        );
        assert_eq!(
            WeatherCondition::from_wmo_code(100),
            WeatherCondition::Unknown
        );
    }
}
