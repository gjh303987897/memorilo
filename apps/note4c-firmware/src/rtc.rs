//! Pure RTC and timezone calculations shared by the hardware adapter and
//! provisioning workflow.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RtcDateTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub weekday: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

/// Convert a desktop UTC snapshot timestamp into local wall-clock time.
pub fn datetime_from_iso8601(value: &str, offset_minutes: i16) -> Option<(i64, RtcDateTime)> {
    let unix_seconds = unix_seconds_from_iso8601(value)?;
    Some((
        unix_seconds,
        datetime_from_unix_seconds(unix_seconds, offset_minutes)?,
    ))
}

pub fn datetime_from_unix_seconds(unix_seconds: i64, offset_minutes: i16) -> Option<RtcDateTime> {
    let local_seconds = unix_seconds.checked_add(i64::from(offset_minutes) * 60)?;
    let days = local_seconds.div_euclid(86_400);
    let day_seconds = local_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_date_from_days(days);
    Some(RtcDateTime {
        year: u16::try_from(year).ok()?,
        month,
        day,
        weekday: u8::try_from((days + 4).rem_euclid(7)).ok()?,
        hour: u8::try_from(day_seconds / 3_600).ok()?,
        minute: u8::try_from((day_seconds % 3_600) / 60).ok()?,
        second: u8::try_from(day_seconds % 60).ok()?,
    })
}

pub fn unix_seconds_from_iso8601(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let year = parse_digits(&bytes[0..4])?;
    let month = parse_digits(&bytes[5..7])?;
    let day = parse_digits(&bytes[8..10])?;
    let hour = parse_digits(&bytes[11..13])?;
    let minute = parse_digits(&bytes[14..16])?;
    let second = parse_digits(&bytes[17..19])?;
    let suffix = &bytes[19..];
    if !(suffix == b"Z"
        || (suffix.first() == Some(&b'.')
            && suffix.last() == Some(&b'Z')
            && suffix[1..suffix.len() - 1].iter().all(u8::is_ascii_digit)))
    {
        return None;
    }
    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(u32::from(year), u32::from(month))
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    days.checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))
}

pub fn timezone_offset_minutes(timezone: &str) -> i16 {
    match timezone {
        "UTC" | "Etc/UTC" | "Europe/London" => 0,
        "Asia/Shanghai" | "Asia/Singapore" | "Asia/Taipei" => 480,
        "Asia/Tokyo" | "Asia/Seoul" => 540,
        "America/Los_Angeles" => -480,
        "America/New_York" => -300,
        _ => 0,
    }
}

pub fn encode_pcf8563_time(time: RtcDateTime) -> Option<[u8; 7]> {
    if !(2000..=2099).contains(&time.year)
        || !(1..=12).contains(&time.month)
        || time.day == 0
        || u32::from(time.day) > days_in_month(u32::from(time.year), u32::from(time.month))
        || time.hour > 23
        || time.minute > 59
        || time.second > 59
    {
        return None;
    }
    Some([
        to_bcd(time.second),
        to_bcd(time.minute),
        to_bcd(time.hour),
        to_bcd(time.day),
        to_bcd(time.weekday % 7),
        to_bcd(time.month),
        to_bcd((time.year - 2000) as u8),
    ])
}

fn parse_digits(value: &[u8]) -> Option<u32> {
    value.iter().try_fold(0_u32, |result, digit| {
        digit
            .is_ascii_digit()
            .then_some(result * 10 + u32::from(digit - b'0'))
    })
}

fn days_from_civil(year: u32, month: u32, day: u32) -> Option<i64> {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_prime = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

fn civil_date_from_days(days: i64) -> (i32, u8, u8) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year as i32, month as u8, day as u8)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn to_bcd(value: u8) -> u8 {
    ((value / 10) << 4) | (value % 10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_snapshot_time_converts_to_local_rtc_time() {
        let (unix, local) = datetime_from_iso8601("2026-09-30T00:00:05.000Z", 480).unwrap();
        assert_eq!(unix, 1_790_726_405);
        assert_eq!(
            local,
            RtcDateTime {
                year: 2026,
                month: 9,
                day: 30,
                weekday: 3,
                hour: 8,
                minute: 0,
                second: 5,
            }
        );
    }

    #[test]
    fn pcf8563_time_encodes_bcd_registers() {
        let encoded = encode_pcf8563_time(RtcDateTime {
            year: 2026,
            month: 9,
            day: 30,
            weekday: 3,
            hour: 8,
            minute: 7,
            second: 6,
        })
        .unwrap();
        assert_eq!(encoded, [0x06, 0x07, 0x08, 0x30, 0x03, 0x09, 0x26]);
    }
}
