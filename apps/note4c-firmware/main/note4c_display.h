#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define NOTE4C_WIDTH 400
#define NOTE4C_HEIGHT 300
#define NOTE4C_FRAME_BYTES (NOTE4C_WIDTH * NOTE4C_HEIGHT / 4)

typedef enum {
    NOTE4C_BLACK = 0,
    NOTE4C_WHITE = 1,
    NOTE4C_YELLOW = 2,
    NOTE4C_RED = 3,
} note4c_color_t;

typedef struct note4c_display note4c_display_t;

esp_err_t note4c_display_init(note4c_display_t **out_display);
esp_err_t note4c_display_refresh(note4c_display_t *display,
                                 const uint8_t *framebuffer,
                                 size_t size);
void note4c_display_deinit(note4c_display_t *display);
