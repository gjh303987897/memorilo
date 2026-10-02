/*
 * Adapted from the ZECTRIX Wiki-recommended four-color firmware at commit
 * 51812e4ab3fa80ba7a5a5a274635ca2cf3901a25. See UPSTREAM.md and LICENSE.
 * SPDX-License-Identifier: MIT
 */

#include "zectrix_note4c_epd.h"

#include <stdbool.h>
#include <stdlib.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

struct zectrix_note4c_epd {
    zectrix_note4c_epd_config_t config;
    spi_device_handle_t spi;
    bool bus_initialized;
};

static const char *TAG = "note4c-ssd2683";

static esp_err_t set_power(zectrix_note4c_epd_t *epd, uint32_t level) {
    esp_err_t err = gpio_hold_dis(epd->config.power);
    if (err != ESP_OK) return err;
    err = gpio_set_level(epd->config.power, level);
    if (err != ESP_OK) return err;
    return gpio_hold_en(epd->config.power);
}

static esp_err_t transmit(zectrix_note4c_epd_t *epd,
                          const uint8_t *data,
                          size_t size) {
    spi_transaction_t transaction = {
        .length = size * 8,
        .tx_buffer = data,
    };
    esp_err_t err = gpio_set_level(epd->config.cs, 0);
    if (err != ESP_OK) return err;
    err = spi_device_polling_transmit(epd->spi, &transaction);
    const esp_err_t cs_err = gpio_set_level(epd->config.cs, 1);
    return err != ESP_OK ? err : cs_err;
}

static esp_err_t send_command(zectrix_note4c_epd_t *epd, uint8_t command) {
    esp_err_t err = gpio_set_level(epd->config.dc, 0);
    if (err != ESP_OK) return err;
    return transmit(epd, &command, 1);
}

static esp_err_t send_data(zectrix_note4c_epd_t *epd,
                           const uint8_t *data,
                           size_t size) {
    esp_err_t err = gpio_set_level(epd->config.dc, 1);
    if (err != ESP_OK) return err;
    return transmit(epd, data, size);
}

static esp_err_t send_data_byte(zectrix_note4c_epd_t *epd, uint8_t data) {
    return send_data(epd, &data, 1);
}

static esp_err_t wait_while_busy(zectrix_note4c_epd_t *epd) {
    const TickType_t start = xTaskGetTickCount();
    const TickType_t timeout = pdMS_TO_TICKS(epd->config.busy_timeout_ms);
    TickType_t last_log = start;

    while (gpio_get_level(epd->config.busy) == 0) {
        const TickType_t now = xTaskGetTickCount();
        if (now - start >= timeout) {
            ESP_LOGE(TAG, "BUSY timeout after %lu ms",
                     (unsigned long)epd->config.busy_timeout_ms);
            return ESP_ERR_TIMEOUT;
        }
        if (now - last_log >= pdMS_TO_TICKS(5000)) {
            ESP_LOGW(TAG, "waiting for BUSY release");
            last_log = now;
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    return ESP_OK;
}

static esp_err_t wake_panel(zectrix_note4c_epd_t *epd) {
    esp_err_t err = set_power(epd, 1);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));

    err = gpio_set_level(epd->config.reset, 1);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));
    err = gpio_set_level(epd->config.reset, 0);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(20));
    err = gpio_set_level(epd->config.reset, 1);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));

    err = wait_while_busy(epd);
    if (err != ESP_OK) return err;
    err = send_command(epd, 0xE9);
    if (err != ESP_OK) return err;
    return send_data_byte(epd, 0x01);
}

static esp_err_t stream_frame(zectrix_note4c_epd_t *epd,
                              const uint8_t *framebuffer) {
    const size_t row_bytes = ZECTRIX_NOTE4C_EPD_WIDTH / 4;
    esp_err_t err = send_command(epd, 0x10);
    if (err != ESP_OK) return err;
    err = wait_while_busy(epd);
    if (err != ESP_OK) return err;

    for (size_t y = 0; y < ZECTRIX_NOTE4C_EPD_HEIGHT; ++y) {
        err = send_data(epd, framebuffer + y * row_bytes, row_bytes);
        if (err != ESP_OK) return err;
        if ((y % 16) == 15) vTaskDelay(1);
    }
    return ESP_OK;
}

static esp_err_t activate_panel(zectrix_note4c_epd_t *epd) {
    esp_err_t err = send_command(epd, 0x04);
    if (err != ESP_OK) return err;
    err = wait_while_busy(epd);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));

    err = send_command(epd, 0x12);
    if (err != ESP_OK) return err;
    err = send_data_byte(epd, 0x00);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));
    err = wait_while_busy(epd);
    if (err != ESP_OK) return err;

    err = send_command(epd, 0x02);
    if (err != ESP_OK) return err;
    err = send_data_byte(epd, 0x00);
    if (err != ESP_OK) return err;
    err = wait_while_busy(epd);
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(20));

    err = send_command(epd, 0x07);
    if (err != ESP_OK) return err;
    return send_data_byte(epd, 0xA5);
}

esp_err_t zectrix_note4c_epd_new(const zectrix_note4c_epd_config_t *config,
                                 zectrix_note4c_epd_t **out_epd) {
    if (!config || !out_epd || config->clock_hz <= 0 ||
        config->busy_timeout_ms == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    zectrix_note4c_epd_t *epd = calloc(1, sizeof(*epd));
    if (!epd) return ESP_ERR_NO_MEM;
    epd->config = *config;

    gpio_config_t outputs = {
        .pin_bit_mask = (1ULL << config->dc) | (1ULL << config->cs) |
                        (1ULL << config->reset) | (1ULL << config->power),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    esp_err_t err = gpio_config(&outputs);
    if (err != ESP_OK) goto fail;

    gpio_config_t input = {
        .pin_bit_mask = 1ULL << config->busy,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    err = gpio_config(&input);
    if (err != ESP_OK) goto fail;

    err = gpio_set_level(config->cs, 1);
    if (err != ESP_OK) goto fail;
    err = gpio_set_level(config->reset, 1);
    if (err != ESP_OK) goto fail;
    err = set_power(epd, 0);
    if (err != ESP_OK) goto fail;

    spi_bus_config_t bus_config = {
        .mosi_io_num = config->mosi,
        .miso_io_num = -1,
        .sclk_io_num = config->sck,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = ZECTRIX_NOTE4C_EPD_FRAME_BYTES,
    };
    err = spi_bus_initialize(config->spi_host, &bus_config, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) goto fail;
    epd->bus_initialized = true;

    spi_device_interface_config_t device_config = {
        .mode = 0,
        .clock_speed_hz = config->clock_hz,
        .spics_io_num = -1,
        .queue_size = 7,
    };
    err = spi_bus_add_device(config->spi_host, &device_config, &epd->spi);
    if (err != ESP_OK) goto fail;

    *out_epd = epd;
    return ESP_OK;

fail:
    zectrix_note4c_epd_delete(epd);
    return err;
}

esp_err_t zectrix_note4c_epd_refresh(zectrix_note4c_epd_t *epd,
                                     const uint8_t *framebuffer,
                                     size_t size) {
    if (!epd || !framebuffer || size != ZECTRIX_NOTE4C_EPD_FRAME_BYTES) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = wake_panel(epd);
    if (err == ESP_OK) err = stream_frame(epd, framebuffer);
    if (err == ESP_OK) err = activate_panel(epd);

    const esp_err_t power_err = set_power(epd, 0);
    if (err == ESP_OK) err = power_err;
    return err;
}

void zectrix_note4c_epd_delete(zectrix_note4c_epd_t *epd) {
    if (!epd) return;
    set_power(epd, 0);
    if (epd->spi) spi_bus_remove_device(epd->spi);
    if (epd->bus_initialized) spi_bus_free(epd->config.spi_host);
    free(epd);
}
