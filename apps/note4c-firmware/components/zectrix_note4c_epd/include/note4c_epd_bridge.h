#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct note4c_epd_bridge note4c_epd_bridge_t;

esp_err_t note4c_epd_bridge_new(note4c_epd_bridge_t **out_display);
esp_err_t note4c_epd_bridge_refresh(note4c_epd_bridge_t *display,
                                    const uint8_t *framebuffer,
                                    size_t size);
void note4c_epd_bridge_delete(note4c_epd_bridge_t *display);
