use std::time::Duration;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ConnectionState {
    #[default]
    Offline,
    Connecting,
    Connected,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ChargeState {
    #[default]
    Unknown,
    OnBattery,
    Charging,
    Full,
    NoBattery,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct BatteryStatus {
    pub millivolts: Option<u16>,
    pub percent: Option<u8>,
    pub charge: ChargeState,
}

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

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum RtcStatus {
    #[default]
    Unavailable,
    Unset,
    Valid(RtcDateTime),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DeviceStatusSnapshot {
    pub battery: BatteryStatus,
    pub rtc: RtcStatus,
    pub connection: ConnectionState,
}

pub fn battery_percent_from_mv(millivolts: u16) -> u8 {
    let voltage = i64::from(millivolts);
    let percent = (-voltage * voltage + 9_016 * voltage - 19_189_000) / 10_000;
    percent.clamp(0, 100) as u8
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChargeSignals {
    pub charging_active: bool,
    pub full_active: bool,
}

#[derive(Clone, Debug)]
pub struct ChargeTracker {
    stable_for: Duration,
    power_hold: Duration,
    alternate_window: Duration,
    charging_since: Option<Duration>,
    full_since: Option<Duration>,
    last_charging: Option<Duration>,
    last_full: Option<Duration>,
    last_power: Option<Duration>,
}

impl Default for ChargeTracker {
    fn default() -> Self {
        Self {
            stable_for: Duration::from_millis(400),
            power_hold: Duration::from_secs(1),
            alternate_window: Duration::from_millis(1_500),
            charging_since: None,
            full_since: None,
            last_charging: None,
            last_full: None,
            last_power: None,
        }
    }
}

impl ChargeTracker {
    pub fn observe(&mut self, now: Duration, signals: ChargeSignals) -> ChargeState {
        if signals.charging_active {
            self.charging_since.get_or_insert(now);
            self.last_charging = Some(now);
            self.last_power = Some(now);
        } else {
            self.charging_since = None;
        }

        if signals.full_active {
            self.full_since.get_or_insert(now);
            self.last_full = Some(now);
            self.last_power = Some(now);
        } else {
            self.full_since = None;
        }

        let power_present = self
            .last_power
            .is_some_and(|seen| now.saturating_sub(seen) <= self.power_hold);
        if !power_present {
            return ChargeState::OnBattery;
        }

        let charging_stable = self
            .charging_since
            .is_some_and(|seen| now.saturating_sub(seen) >= self.stable_for);
        let full_stable = self
            .full_since
            .is_some_and(|seen| now.saturating_sub(seen) >= self.stable_for);
        let alternating = self
            .last_charging
            .zip(self.last_full)
            .is_some_and(|(charging, full)| {
                now.saturating_sub(charging) <= self.alternate_window
                    && now.saturating_sub(full) <= self.alternate_window
            });

        if alternating && !charging_stable && !full_stable {
            ChargeState::NoBattery
        } else if full_stable {
            ChargeState::Full
        } else {
            ChargeState::Charging
        }
    }
}

pub fn decode_pcf8563_time(registers: [u8; 7]) -> RtcStatus {
    if registers[0] & 0x80 != 0 {
        return RtcStatus::Unset;
    }

    let Some(second) = from_bcd(registers[0] & 0x7f) else {
        return RtcStatus::Unset;
    };
    let Some(minute) = from_bcd(registers[1] & 0x7f) else {
        return RtcStatus::Unset;
    };
    let Some(hour) = from_bcd(registers[2] & 0x3f) else {
        return RtcStatus::Unset;
    };
    let Some(day) = from_bcd(registers[3] & 0x3f) else {
        return RtcStatus::Unset;
    };
    let Some(weekday) = from_bcd(registers[4] & 0x07) else {
        return RtcStatus::Unset;
    };
    let Some(month) = from_bcd(registers[5] & 0x1f) else {
        return RtcStatus::Unset;
    };
    let Some(year_low) = from_bcd(registers[6]) else {
        return RtcStatus::Unset;
    };
    let year = 2_000 + u16::from(year_low);

    if second > 59
        || minute > 59
        || hour > 23
        || weekday > 6
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
    {
        return RtcStatus::Unset;
    }

    RtcStatus::Valid(RtcDateTime {
        year,
        month,
        day,
        weekday,
        hour,
        minute,
        second,
    })
}

fn from_bcd(value: u8) -> Option<u8> {
    let high = value >> 4;
    let low = value & 0x0f;
    (high <= 9 && low <= 9).then_some(high * 10 + low)
}

fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

#[cfg(target_os = "espidf")]
mod hardware {
    use std::ptr;
    use std::time::Duration;

    use anyhow::{Context, Result};
    use esp_idf_sys::{
        adc_atten_t_ADC_ATTEN_DB_12, adc_bitwidth_t_ADC_BITWIDTH_12,
        adc_cali_create_scheme_curve_fitting, adc_cali_curve_fitting_config_t,
        adc_cali_delete_scheme_curve_fitting, adc_cali_handle_t, adc_cali_raw_to_voltage,
        adc_channel_t_ADC_CHANNEL_3, adc_oneshot_chan_cfg_t, adc_oneshot_config_channel,
        adc_oneshot_del_unit, adc_oneshot_new_unit, adc_oneshot_read, adc_oneshot_unit_handle_t,
        adc_oneshot_unit_init_cfg_t, adc_ulp_mode_t_ADC_ULP_MODE_DISABLE, adc_unit_t_ADC_UNIT_1,
        esp, gpio_get_level, gpio_mode_t_GPIO_MODE_INPUT, gpio_pull_mode_t_GPIO_FLOATING,
        gpio_reset_pin, gpio_set_direction, gpio_set_pull_mode,
        i2c_addr_bit_len_t_I2C_ADDR_BIT_LEN_7, i2c_del_master_bus, i2c_device_config_t,
        i2c_master_bus_add_device, i2c_master_bus_config_t, i2c_master_bus_handle_t,
        i2c_master_bus_rm_device, i2c_master_dev_handle_t, i2c_master_transmit_receive,
        i2c_new_master_bus, i2c_port_t_I2C_NUM_0, soc_periph_i2c_clk_src_t_I2C_CLK_SRC_DEFAULT,
    };

    use super::{
        BatteryStatus, ChargeSignals, ChargeState, ChargeTracker, ConnectionState,
        DeviceStatusSnapshot, RtcStatus, battery_percent_from_mv, decode_pcf8563_time,
    };

    const GPIO_CHARGE_DETECT: i32 = 2;
    const GPIO_CHARGE_FULL: i32 = 1;
    const GPIO_I2C_SDA: i32 = 47;
    const GPIO_I2C_SCL: i32 = 48;
    const RTC_ADDRESS: u16 = 0x51;
    const RTC_SECONDS_REGISTER: u8 = 0x02;

    pub struct DeviceStatusService {
        battery: Option<BatterySensor>,
        rtc: Option<RtcReader>,
        charge_available: bool,
        charge_tracker: ChargeTracker,
        connection: ConnectionState,
    }

    impl DeviceStatusService {
        pub fn new() -> Self {
            let charge_available = initialize_charge_pins()
                .inspect_err(|error| log::warn!("charge signal initialization failed: {error:#}"))
                .is_ok();
            let battery = BatterySensor::new()
                .inspect_err(|error| log::warn!("battery ADC unavailable: {error:#}"))
                .ok();
            let rtc = RtcReader::new()
                .inspect_err(|error| log::warn!("RTC unavailable: {error:#}"))
                .ok();
            Self {
                battery,
                rtc,
                charge_available,
                charge_tracker: ChargeTracker::default(),
                connection: ConnectionState::Offline,
            }
        }

        pub fn set_connection(&mut self, connection: ConnectionState) {
            self.connection = connection;
        }

        pub fn sample(&mut self, now: Duration) -> DeviceStatusSnapshot {
            let charge = if self.charge_available {
                self.charge_tracker.observe(
                    now,
                    ChargeSignals {
                        charging_active: unsafe { gpio_get_level(GPIO_CHARGE_DETECT) } == 0,
                        full_active: unsafe { gpio_get_level(GPIO_CHARGE_FULL) } == 1,
                    },
                )
            } else {
                ChargeState::Unknown
            };
            let battery = self
                .battery
                .as_mut()
                .and_then(|sensor| {
                    sensor
                        .sample()
                        .inspect_err(|error| log::warn!("battery sample failed: {error:#}"))
                        .ok()
                })
                .map_or(
                    BatteryStatus {
                        millivolts: None,
                        percent: None,
                        charge,
                    },
                    |millivolts| BatteryStatus {
                        millivolts: Some(millivolts),
                        percent: Some(battery_percent_from_mv(millivolts)),
                        charge,
                    },
                );
            let rtc = self
                .rtc
                .as_mut()
                .and_then(|rtc| {
                    rtc.read()
                        .inspect_err(|error| log::warn!("RTC read failed: {error:#}"))
                        .ok()
                })
                .unwrap_or(RtcStatus::Unavailable);

            DeviceStatusSnapshot {
                battery,
                rtc,
                connection: self.connection,
            }
        }
    }

    fn initialize_charge_pins() -> Result<()> {
        for pin in [GPIO_CHARGE_DETECT, GPIO_CHARGE_FULL] {
            esp!(unsafe { gpio_reset_pin(pin) })?;
            esp!(unsafe { gpio_set_direction(pin, gpio_mode_t_GPIO_MODE_INPUT) })?;
            esp!(unsafe { gpio_set_pull_mode(pin, gpio_pull_mode_t_GPIO_FLOATING) })?;
        }
        Ok(())
    }

    struct BatterySensor {
        adc: adc_oneshot_unit_handle_t,
        calibration: adc_cali_handle_t,
    }

    impl BatterySensor {
        fn new() -> Result<Self> {
            let mut adc = ptr::null_mut();
            let unit_config = adc_oneshot_unit_init_cfg_t {
                unit_id: adc_unit_t_ADC_UNIT_1,
                ulp_mode: adc_ulp_mode_t_ADC_ULP_MODE_DISABLE,
                ..Default::default()
            };
            esp!(unsafe { adc_oneshot_new_unit(&unit_config, &mut adc) })
                .context("create ADC1 oneshot unit")?;

            let channel_config = adc_oneshot_chan_cfg_t {
                atten: adc_atten_t_ADC_ATTEN_DB_12,
                bitwidth: adc_bitwidth_t_ADC_BITWIDTH_12,
            };
            if let Err(error) = esp!(unsafe {
                adc_oneshot_config_channel(adc, adc_channel_t_ADC_CHANNEL_3, &channel_config)
            }) {
                unsafe { adc_oneshot_del_unit(adc) };
                return Err(error).context("configure battery ADC channel");
            }

            let calibration_config = adc_cali_curve_fitting_config_t {
                unit_id: adc_unit_t_ADC_UNIT_1,
                chan: adc_channel_t_ADC_CHANNEL_3,
                atten: adc_atten_t_ADC_ATTEN_DB_12,
                bitwidth: adc_bitwidth_t_ADC_BITWIDTH_12,
            };
            let mut calibration = ptr::null_mut();
            if let Err(error) = esp!(unsafe {
                adc_cali_create_scheme_curve_fitting(&calibration_config, &mut calibration)
            }) {
                unsafe { adc_oneshot_del_unit(adc) };
                return Err(error).context("create calibrated battery ADC curve");
            }

            Ok(Self { adc, calibration })
        }

        fn sample(&mut self) -> Result<u16> {
            let mut sum = 0_i32;
            for _ in 0..10 {
                let mut raw = 0;
                esp!(unsafe { adc_oneshot_read(self.adc, adc_channel_t_ADC_CHANNEL_3, &mut raw) })
                    .context("read battery ADC")?;
                let mut pin_millivolts = 0;
                esp!(unsafe {
                    adc_cali_raw_to_voltage(self.calibration, raw, &mut pin_millivolts)
                })
                .context("calibrate battery ADC")?;
                sum = sum.saturating_add(pin_millivolts);
            }
            let battery_millivolts = (sum / 10).saturating_mul(2);
            u16::try_from(battery_millivolts).context("battery voltage outside u16 range")
        }
    }

    impl Drop for BatterySensor {
        fn drop(&mut self) {
            unsafe {
                adc_cali_delete_scheme_curve_fitting(self.calibration);
                adc_oneshot_del_unit(self.adc);
            }
        }
    }

    struct RtcReader {
        bus: i2c_master_bus_handle_t,
        device: i2c_master_dev_handle_t,
    }

    impl RtcReader {
        fn new() -> Result<Self> {
            let mut flags: esp_idf_sys::i2c_master_bus_config_t__bindgen_ty_2 = Default::default();
            flags.set_enable_internal_pullup(1);
            let bus_config = i2c_master_bus_config_t {
                i2c_port: i2c_port_t_I2C_NUM_0 as _,
                sda_io_num: GPIO_I2C_SDA,
                scl_io_num: GPIO_I2C_SCL,
                __bindgen_anon_1: esp_idf_sys::i2c_master_bus_config_t__bindgen_ty_1 {
                    clk_source: soc_periph_i2c_clk_src_t_I2C_CLK_SRC_DEFAULT,
                },
                glitch_ignore_cnt: 7,
                intr_priority: 0,
                trans_queue_depth: 0,
                flags,
            };
            let mut bus = ptr::null_mut();
            esp!(unsafe { i2c_new_master_bus(&bus_config, &mut bus) })
                .context("create board I2C bus")?;

            let device_config = i2c_device_config_t {
                dev_addr_length: i2c_addr_bit_len_t_I2C_ADDR_BIT_LEN_7,
                device_address: RTC_ADDRESS,
                scl_speed_hz: 100_000,
                ..Default::default()
            };
            let mut device = ptr::null_mut();
            if let Err(error) =
                esp!(unsafe { i2c_master_bus_add_device(bus, &device_config, &mut device) })
            {
                unsafe { i2c_del_master_bus(bus) };
                return Err(error).context("add PCF8563 to I2C bus");
            }
            Ok(Self { bus, device })
        }

        fn read(&mut self) -> Result<RtcStatus> {
            let register = [RTC_SECONDS_REGISTER];
            let mut values = [0_u8; 7];
            esp!(unsafe {
                i2c_master_transmit_receive(
                    self.device,
                    register.as_ptr(),
                    register.len(),
                    values.as_mut_ptr(),
                    values.len(),
                    100,
                )
            })
            .context("read PCF8563 clock registers")?;
            Ok(decode_pcf8563_time(values))
        }
    }

    impl Drop for RtcReader {
        fn drop(&mut self) {
            unsafe {
                i2c_master_bus_rm_device(self.device);
                i2c_del_master_bus(self.bus);
            }
        }
    }
}

#[cfg(target_os = "espidf")]
pub use hardware::DeviceStatusService;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn battery_curve_is_bounded() {
        assert_eq!(battery_percent_from_mv(2_500), 0);
        assert_eq!(battery_percent_from_mv(3_700), 48);
        assert_eq!(battery_percent_from_mv(4_300), 100);
    }

    #[test]
    fn charge_signals_are_stabilized_and_detect_alternating_no_battery_state() {
        let mut tracker = ChargeTracker::default();
        assert_eq!(
            tracker.observe(
                Duration::ZERO,
                ChargeSignals {
                    charging_active: true,
                    full_active: false,
                }
            ),
            ChargeState::Charging
        );
        assert_eq!(
            tracker.observe(
                Duration::from_millis(500),
                ChargeSignals {
                    charging_active: true,
                    full_active: false,
                }
            ),
            ChargeState::Charging
        );

        let mut tracker = ChargeTracker::default();
        tracker.observe(
            Duration::ZERO,
            ChargeSignals {
                charging_active: true,
                full_active: false,
            },
        );
        assert_eq!(
            tracker.observe(
                Duration::from_millis(100),
                ChargeSignals {
                    charging_active: false,
                    full_active: true,
                }
            ),
            ChargeState::NoBattery
        );
    }

    #[test]
    fn rtc_rejects_low_voltage_and_invalid_calendar_values() {
        assert_eq!(
            decode_pcf8563_time([0x80, 0, 0, 1, 0, 1, 26]),
            RtcStatus::Unset
        );
        assert_eq!(
            decode_pcf8563_time([0, 0, 0, 0x31, 0, 0x02, 0x26]),
            RtcStatus::Unset
        );
    }

    #[test]
    fn rtc_decodes_a_valid_leap_day() {
        assert_eq!(
            decode_pcf8563_time([0x56, 0x34, 0x12, 0x29, 0x04, 0x02, 0x28]),
            RtcStatus::Valid(RtcDateTime {
                year: 2028,
                month: 2,
                day: 29,
                weekday: 4,
                hour: 12,
                minute: 34,
                second: 56,
            })
        );
    }
}
