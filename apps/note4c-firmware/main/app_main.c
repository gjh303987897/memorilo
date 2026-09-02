#include "note4c_board.h"
#include "note4c_display.h"
#include "note4c_test_pattern.h"
#include "todo_model.h"
#include "todo_ui.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "note4c-app";

#ifndef CONFIG_NOTE4C_COLOR_TEST_PATTERN
typedef struct {
    note4c_display_t *display;
    todo_model_t model;
    SemaphoreHandle_t model_mutex;
    TaskHandle_t display_task;
} note4c_app_t;

static note4c_app_t app;
static uint8_t display_framebuffer[NOTE4C_FRAME_BYTES];

static void display_task(void *arg) {
    note4c_app_t *state = arg;

    for (;;) {
        /* Clear all pending requests and render only the newest model state. */
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        xSemaphoreTake(state->model_mutex, portMAX_DELAY);
        todo_ui_render(&state->model, display_framebuffer);
        xSemaphoreGive(state->model_mutex);

        const esp_err_t err = note4c_display_refresh(
            state->display, display_framebuffer, sizeof(display_framebuffer));
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "display refresh failed: %s", esp_err_to_name(err));
        } else {
            ESP_LOGI(TAG, "displayed latest TODO state");
        }
    }
}

static void apply_button(note4c_app_t *state, note4c_button_t button) {
    xSemaphoreTake(state->model_mutex, portMAX_DELAY);
    if (button == NOTE4C_BUTTON_UP) {
        todo_model_move(&state->model, -1);
    } else if (button == NOTE4C_BUTTON_DOWN) {
        todo_model_move(&state->model, 1);
    } else {
        todo_model_toggle_selected(&state->model);
    }
    const size_t selected = state->model.selected;
    xSemaphoreGive(state->model_mutex);

    xTaskNotifyGive(state->display_task);
    ESP_LOGI(TAG, "button accepted; selected=%u, latest state queued",
             (unsigned)selected);
}
#endif

void app_main(void) {
    ESP_ERROR_CHECK(note4c_board_init());

    note4c_display_t *display = NULL;
    ESP_ERROR_CHECK(note4c_display_init(&display));

#ifdef CONFIG_NOTE4C_COLOR_TEST_PATTERN
    static uint8_t framebuffer[NOTE4C_FRAME_BYTES];
    note4c_test_pattern_render(framebuffer);
    ESP_ERROR_CHECK(note4c_display_refresh(display, framebuffer, sizeof(framebuffer)));
    ESP_LOGW(TAG, "NOTE4C first-hardware-test color bars displayed; TODO input is disabled");
    for (;;) vTaskDelay(pdMS_TO_TICKS(1000));
#else
    app.display = display;
    todo_model_init(&app.model);
    app.model_mutex = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(app.model_mutex ? ESP_OK : ESP_ERR_NO_MEM);
    const BaseType_t task_created = xTaskCreate(
        display_task, "note4c_display", 4096, &app, 4, &app.display_task);
    ESP_ERROR_CHECK(task_created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);

    xTaskNotifyGive(app.display_task);

    ESP_LOGI(TAG, "offline fake TODO UI ready (%u items); input remains active during refresh",
             (unsigned)app.model.count);
    for (;;) {
        note4c_button_t button;
        if (note4c_board_poll_button(&button)) {
            apply_button(&app, button);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
#endif
}
