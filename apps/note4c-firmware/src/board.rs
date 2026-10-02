use anyhow::Result;
use esp_idf_sys::{
    esp, esp_deep_sleep_start, esp_sleep_enable_ext0_wakeup, gpio_get_level, gpio_hold_dis,
    gpio_hold_en, gpio_mode_t_GPIO_MODE_INPUT, gpio_mode_t_GPIO_MODE_OUTPUT, gpio_num_t,
    gpio_pull_mode_t_GPIO_PULLUP_ONLY, gpio_reset_pin, gpio_set_direction, gpio_set_level,
    gpio_set_pull_mode,
};

use crate::input::ButtonState;

const GPIO_OK: gpio_num_t = 0;
const GPIO_UP: gpio_num_t = 39;
const GPIO_DOWN: gpio_num_t = 18;
const GPIO_BATTERY_LATCH: gpio_num_t = 17;
const GPIO_STATUS_LED: gpio_num_t = 3;
const BUTTON_PINS: [gpio_num_t; 3] = [GPIO_UP, GPIO_OK, GPIO_DOWN];

pub struct Board;

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

        Ok(Self)
    }

    pub fn button_state(&self) -> ButtonState {
        ButtonState {
            up: unsafe { gpio_get_level(GPIO_UP) } == 0,
            ok: unsafe { gpio_get_level(GPIO_OK) } == 0,
            down: unsafe { gpio_get_level(GPIO_DOWN) } == 0,
        }
    }

    pub fn prepare_deep_sleep(&self) -> Result<()> {
        esp!(unsafe { gpio_set_level(GPIO_STATUS_LED, 1) })?;
        esp!(unsafe { gpio_hold_en(GPIO_STATUS_LED) })?;
        esp!(unsafe { gpio_set_level(GPIO_BATTERY_LATCH, 1) })?;
        esp!(unsafe { gpio_hold_en(GPIO_BATTERY_LATCH) })?;
        esp!(unsafe { esp_sleep_enable_ext0_wakeup(GPIO_OK, 0) })?;
        Ok(())
    }

    pub fn enter_deep_sleep(&self) -> ! {
        unsafe { esp_deep_sleep_start() }
    }
}
