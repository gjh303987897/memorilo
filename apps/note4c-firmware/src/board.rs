use std::time::{Duration, Instant};

use anyhow::Result;
use esp_idf_sys::{
    esp, gpio_get_level, gpio_hold_dis, gpio_mode_t_GPIO_MODE_INPUT, gpio_mode_t_GPIO_MODE_OUTPUT,
    gpio_num_t, gpio_pull_mode_t_GPIO_PULLUP_ONLY, gpio_reset_pin, gpio_set_direction,
    gpio_set_level, gpio_set_pull_mode,
};

const GPIO_OK: gpio_num_t = 0;
const GPIO_UP: gpio_num_t = 39;
const GPIO_DOWN: gpio_num_t = 18;
const GPIO_BATTERY_LATCH: gpio_num_t = 17;
const GPIO_STATUS_LED: gpio_num_t = 3;
const BUTTON_PINS: [gpio_num_t; 3] = [GPIO_UP, GPIO_OK, GPIO_DOWN];
const DEBOUNCE: Duration = Duration::from_millis(35);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Button {
    Up,
    Ok,
    Down,
}

pub struct Board {
    previous_level: [i32; 3],
    changed_at: [Option<Instant>; 3],
}

impl Board {
    pub fn new() -> Result<Self> {
        for pin in BUTTON_PINS {
            esp!(unsafe { gpio_reset_pin(pin) })?;
            esp!(unsafe { gpio_set_direction(pin, gpio_mode_t_GPIO_MODE_INPUT) })?;
            esp!(unsafe { gpio_set_pull_mode(pin, gpio_pull_mode_t_GPIO_PULLUP_ONLY) })?;
        }

        esp!(unsafe { gpio_hold_dis(GPIO_STATUS_LED) })?;
        for pin in [GPIO_BATTERY_LATCH, GPIO_STATUS_LED] {
            esp!(unsafe { gpio_reset_pin(pin) })?;
            esp!(unsafe { gpio_set_direction(pin, gpio_mode_t_GPIO_MODE_OUTPUT) })?;
        }
        esp!(unsafe { gpio_set_level(GPIO_BATTERY_LATCH, 1) })?;
        esp!(unsafe { gpio_set_level(GPIO_STATUS_LED, 1) })?;

        Ok(Self {
            previous_level: [1; 3],
            changed_at: [None; 3],
        })
    }

    pub fn poll_button(&mut self) -> Option<Button> {
        let now = Instant::now();
        for (index, pin) in BUTTON_PINS.into_iter().enumerate() {
            let level = unsafe { gpio_get_level(pin) };
            if level != self.previous_level[index] {
                self.previous_level[index] = level;
                self.changed_at[index] = Some(now);
                continue;
            }

            let settled = self.changed_at[index]
                .is_some_and(|changed_at| now.duration_since(changed_at) >= DEBOUNCE);
            if level == 0 && settled {
                self.changed_at[index] = None;
                return Some(match index {
                    0 => Button::Up,
                    1 => Button::Ok,
                    _ => Button::Down,
                });
            }
        }
        None
    }
}
