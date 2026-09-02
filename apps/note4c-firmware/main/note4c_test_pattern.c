#include "note4c_test_pattern.h"

#include <stddef.h>

#include "note4c_display.h"

static uint8_t solid_color_byte(note4c_color_t color) {
    const uint8_t value = (uint8_t)color;
    return (uint8_t)((value << 6) | (value << 4) | (value << 2) | value);
}

void note4c_test_pattern_render(uint8_t *framebuffer) {
    if (!framebuffer) return;

    const size_t row_bytes = NOTE4C_WIDTH / 4;
    const size_t bar_bytes = row_bytes / 4;
    const note4c_color_t colors[] = {
        NOTE4C_BLACK,
        NOTE4C_WHITE,
        NOTE4C_RED,
        NOTE4C_YELLOW,
    };

    for (size_t y = 0; y < NOTE4C_HEIGHT; ++y) {
        uint8_t *row = framebuffer + y * row_bytes;
        for (size_t bar = 0; bar < 4; ++bar) {
            const uint8_t fill = solid_color_byte(colors[bar]);
            for (size_t x = 0; x < bar_bytes; ++x) {
                row[bar * bar_bytes + x] = fill;
            }
        }
    }
}
