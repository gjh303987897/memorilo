#include "note4c_board.h"

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include <stddef.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define NOTE4C_GPIO_OK GPIO_NUM_0
#define NOTE4C_GPIO_UP GPIO_NUM_39
#define NOTE4C_GPIO_DOWN GPIO_NUM_18
#define NOTE4C_GPIO_BATTERY_LATCH GPIO_NUM_17
#define NOTE4C_GPIO_STATUS_LED GPIO_NUM_3

static const char *TAG = "note4c-board";
static const gpio_num_t pins[] = {NOTE4C_GPIO_UP, NOTE4C_GPIO_OK, NOTE4C_GPIO_DOWN};
static int previous_level[] = {1, 1, 1};
static TickType_t changed_at[] = {0, 0, 0};

esp_err_t note4c_board_init(void) {
    gpio_config_t config = {
        .pin_bit_mask = (1ULL << NOTE4C_GPIO_OK) | (1ULL << NOTE4C_GPIO_UP) |
                        (1ULL << NOTE4C_GPIO_DOWN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&config), TAG, "button GPIO setup failed");
    ESP_RETURN_ON_ERROR(gpio_hold_dis(NOTE4C_GPIO_STATUS_LED), TAG,
                        "status LED hold disable failed");
    gpio_config_t outputs = {
        .pin_bit_mask = (1ULL << NOTE4C_GPIO_BATTERY_LATCH) |
                        (1ULL << NOTE4C_GPIO_STATUS_LED),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&outputs), TAG, "board output setup failed");
    ESP_RETURN_ON_ERROR(gpio_set_level(NOTE4C_GPIO_BATTERY_LATCH, 1), TAG,
                        "battery latch enable failed");
    ESP_RETURN_ON_ERROR(gpio_set_level(NOTE4C_GPIO_STATUS_LED, 1), TAG,
                        "status LED disable failed");
    return ESP_OK;
}

bool note4c_board_poll_button(note4c_button_t *button) {
    if (!button) return false;
    const TickType_t now = xTaskGetTickCount();
    const TickType_t debounce = pdMS_TO_TICKS(35);
    for (size_t i = 0; i < sizeof(pins) / sizeof(pins[0]); i++) {
        const int level = gpio_get_level(pins[i]);
        if (level != previous_level[i]) {
            previous_level[i] = level;
            changed_at[i] = now;
            continue;
        }
        if (level == 0 && changed_at[i] != 0 && now - changed_at[i] >= debounce) {
            /* Consume the press until the key is released. */
            changed_at[i] = 0;
            *button = (note4c_button_t)i;
            return true;
        }
    }
    return false;
}
