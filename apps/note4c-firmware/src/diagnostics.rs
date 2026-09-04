use std::time::Duration;

#[cfg(not(target_os = "espidf"))]
use std::sync::OnceLock;
#[cfg(not(target_os = "espidf"))]
use std::time::Instant;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RuntimeDiagnostics {
    pub uptime_ms: u64,
    pub free_internal_bytes: Option<u32>,
    pub minimum_free_internal_bytes: Option<u32>,
    pub free_psram_bytes: Option<u32>,
    pub minimum_free_psram_bytes: Option<u32>,
    pub stack_high_water_bytes: Option<u32>,
    pub buttons: [bool; 3],
    pub last_input: &'static str,
    pub last_error: Option<&'static str>,
}

impl RuntimeDiagnostics {
    pub fn sample(buttons: [bool; 3], last_input: &'static str) -> Self {
        #[cfg(target_os = "espidf")]
        {
            let internal_caps = esp_idf_sys::MALLOC_CAP_INTERNAL | esp_idf_sys::MALLOC_CAP_8BIT;
            let psram_caps = esp_idf_sys::MALLOC_CAP_SPIRAM | esp_idf_sys::MALLOC_CAP_8BIT;
            let (
                free_internal_bytes,
                minimum_free_internal_bytes,
                free_psram_bytes,
                minimum_free_psram_bytes,
                stack_high_water_bytes,
            ) = unsafe {
                (
                    esp_idf_sys::heap_caps_get_free_size(internal_caps),
                    esp_idf_sys::heap_caps_get_minimum_free_size(internal_caps),
                    esp_idf_sys::heap_caps_get_free_size(psram_caps),
                    esp_idf_sys::heap_caps_get_minimum_free_size(psram_caps),
                    esp_idf_sys::uxTaskGetStackHighWaterMark(std::ptr::null_mut()),
                )
            };
            return Self {
                uptime_ms: uptime().as_millis() as u64,
                free_internal_bytes: Some(saturating_u32(free_internal_bytes)),
                minimum_free_internal_bytes: Some(saturating_u32(minimum_free_internal_bytes)),
                free_psram_bytes: Some(saturating_u32(free_psram_bytes)),
                minimum_free_psram_bytes: Some(saturating_u32(minimum_free_psram_bytes)),
                stack_high_water_bytes: Some(stack_high_water_bytes),
                buttons,
                last_input,
                last_error: None,
            };
        }

        #[cfg(not(target_os = "espidf"))]
        Self {
            uptime_ms: uptime().as_millis() as u64,
            buttons,
            last_input,
            ..Self::default()
        }
    }
}

#[cfg(target_os = "espidf")]
fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

pub struct RefreshMeasurement {
    sequence: u32,
    started_us: i64,
}

impl RefreshMeasurement {
    pub fn start(sequence: u32) -> Self {
        log_snapshot("refresh_start", "display");
        Self {
            sequence,
            started_us: uptime_us(),
        }
    }

    pub fn finish(self, succeeded: bool) {
        let finished_us = uptime_us();
        let duration_ms = finished_us.saturating_sub(self.started_us) / 1_000;
        log::info!(
            "DIAG refresh_end sequence={} succeeded={} duration_ms={} uptime_ms={}",
            self.sequence,
            succeeded,
            duration_ms,
            finished_us / 1_000
        );
        if self.sequence == 1 {
            log::info!(
                "DIAG boot_complete first_frame_uptime_ms={}",
                finished_us / 1_000
            );
        }
        log_snapshot("refresh_end", "display");
    }
}

pub fn uptime() -> Duration {
    Duration::from_micros(uptime_us().max(0) as u64)
}

pub fn log_snapshot(event: &str, task: &str) {
    #[cfg(target_os = "espidf")]
    {
        let internal_caps = esp_idf_sys::MALLOC_CAP_INTERNAL | esp_idf_sys::MALLOC_CAP_8BIT;
        let psram_caps = esp_idf_sys::MALLOC_CAP_SPIRAM | esp_idf_sys::MALLOC_CAP_8BIT;

        let (
            free_heap_bytes,
            min_free_heap_bytes,
            free_internal_bytes,
            min_free_internal_bytes,
            free_psram_bytes,
            min_free_psram_bytes,
            stack_high_water_bytes,
        ) = unsafe {
            (
                esp_idf_sys::esp_get_free_heap_size(),
                esp_idf_sys::esp_get_minimum_free_heap_size(),
                esp_idf_sys::heap_caps_get_free_size(internal_caps),
                esp_idf_sys::heap_caps_get_minimum_free_size(internal_caps),
                esp_idf_sys::heap_caps_get_free_size(psram_caps),
                esp_idf_sys::heap_caps_get_minimum_free_size(psram_caps),
                esp_idf_sys::uxTaskGetStackHighWaterMark(std::ptr::null_mut()),
            )
        };

        log::info!(
            "DIAG snapshot event={} task={} uptime_ms={} free_heap_bytes={} min_free_heap_bytes={} free_internal_bytes={} min_free_internal_bytes={} free_psram_bytes={} min_free_psram_bytes={} stack_high_water_bytes={}",
            event,
            task,
            uptime().as_millis(),
            free_heap_bytes,
            min_free_heap_bytes,
            free_internal_bytes,
            min_free_internal_bytes,
            free_psram_bytes,
            min_free_psram_bytes,
            stack_high_water_bytes
        );
    }

    #[cfg(not(target_os = "espidf"))]
    log::info!(
        "DIAG snapshot event={} task={} uptime_ms={}",
        event,
        task,
        uptime().as_millis()
    );
}

#[cfg(target_os = "espidf")]
fn uptime_us() -> i64 {
    unsafe { esp_idf_sys::esp_timer_get_time() }
}

#[cfg(not(target_os = "espidf"))]
fn uptime_us() -> i64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_micros() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_sample_preserves_input_without_fabricating_hardware_metrics() {
        let sample = RuntimeDiagnostics::sample([true, false, true], "up+down");
        assert_eq!(sample.buttons, [true, false, true]);
        assert_eq!(sample.last_input, "up+down");
        assert_eq!(sample.free_internal_bytes, None);
        assert_eq!(sample.free_psram_bytes, None);
    }
}
