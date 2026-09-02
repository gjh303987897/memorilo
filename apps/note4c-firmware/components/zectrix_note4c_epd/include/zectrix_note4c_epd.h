#pragma once

#include <stddef.h>
#include <stdint.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_err.h"

#define ZECTRIX_NOTE4C_EPD_WIDTH 400
#define ZECTRIX_NOTE4C_EPD_HEIGHT 300
#define ZECTRIX_NOTE4C_EPD_FRAME_BYTES \
    (ZECTRIX_NOTE4C_EPD_WIDTH * ZECTRIX_NOTE4C_EPD_HEIGHT / 4)

typedef struct zectrix_note4c_epd zectrix_note4c_epd_t;

typedef struct {
    spi_host_device_t spi_host;
    gpio_num_t dc;
    gpio_num_t cs;
    gpio_num_t sck;
    gpio_num_t mosi;
    gpio_num_t reset;
    gpio_num_t busy;
    gpio_num_t power;
    int clock_hz;
    uint32_t busy_timeout_ms;
} zectrix_note4c_epd_config_t;

#define ZECTRIX_NOTE4C_EPD_CONFIG_DEFAULT()                \
    {                                                       \
        .spi_host = SPI3_HOST, .dc = GPIO_NUM_10,           \
        .cs = GPIO_NUM_11, .sck = GPIO_NUM_12,              \
        .mosi = GPIO_NUM_13, .reset = GPIO_NUM_9,           \
        .busy = GPIO_NUM_8, .power = GPIO_NUM_6,            \
        .clock_hz = 40 * 1000 * 1000,                       \
        .busy_timeout_ms = 120 * 1000,                      \
    }

esp_err_t zectrix_note4c_epd_new(const zectrix_note4c_epd_config_t *config,
                                 zectrix_note4c_epd_t **out_epd);
esp_err_t zectrix_note4c_epd_refresh(zectrix_note4c_epd_t *epd,
                                     const uint8_t *framebuffer,
                                     size_t size);
void zectrix_note4c_epd_delete(zectrix_note4c_epd_t *epd);
