#pragma once

#include <stdbool.h>
#include "esp_err.h"

typedef enum {
    NOTE4C_BUTTON_UP = 0,
    NOTE4C_BUTTON_OK,
    NOTE4C_BUTTON_DOWN,
} note4c_button_t;

esp_err_t note4c_board_init(void);

/* Polls debounced active-low buttons. Returns false when no edge occurred. */
bool note4c_board_poll_button(note4c_button_t *button);
