#include "todo_ui.h"
#include "note4c_display.h"

#include <stdbool.h>
#include <string.h>

#define ROW_BYTES (NOTE4C_WIDTH / 4)

static void set_pixel(uint8_t *fb, int x, int y, note4c_color_t color) {
    if ((unsigned)x >= NOTE4C_WIDTH || (unsigned)y >= NOTE4C_HEIGHT) return;
    uint8_t *byte = &fb[y * ROW_BYTES + x / 4];
    const uint8_t shift = (uint8_t)(6 - ((x & 3) * 2));
    *byte = (uint8_t)((*byte & ~(3u << shift)) | ((uint8_t)color << shift));
}

static void box(uint8_t *fb, int x, int y, int w, int h,
                bool filled, note4c_color_t color) {
    for (int yy = 0; yy < h; yy++) {
        for (int xx = 0; xx < w; xx++) {
            if (filled || yy == 0 || yy == h - 1 || xx == 0 || xx == w - 1)
                set_pixel(fb, x + xx, y + yy, color);
        }
    }
}

/* Compact 5x7 ASCII glyphs for the offline prototype. Unknown glyphs are '?'. */
static const uint8_t glyphs[128][5] = {
    [' '] = {0, 0, 0, 0, 0}, ['?'] = {0x1e, 0x05, 0x05, 0x15, 0x0e},
    ['-'] = {0x08, 0x08, 0x08, 0x08, 0x08}, ['/'] = {0x10, 0x08, 0x04, 0x02, 0x01},
    [':'] = {0, 0x14, 0, 0x14, 0},
    ['0'] = {0x0e, 0x11, 0x11, 0x11, 0x0e}, ['1'] = {0x00, 0x12, 0x1f, 0x10, 0x00},
    ['2'] = {0x12, 0x19, 0x15, 0x12, 0x00}, ['3'] = {0x11, 0x15, 0x15, 0x0a, 0x00},
    ['4'] = {0x07, 0x04, 0x1f, 0x04, 0x00}, ['5'] = {0x17, 0x15, 0x15, 0x09, 0x00},
    ['6'] = {0x0e, 0x15, 0x15, 0x08, 0x00}, ['7'] = {0x01, 0x01, 0x19, 0x07, 0x00},
    ['8'] = {0x0a, 0x15, 0x15, 0x0a, 0x00}, ['9'] = {0x02, 0x15, 0x15, 0x0e, 0x00},
    ['A'] = {0x1e, 0x05, 0x05, 0x1e, 0x00}, ['B'] = {0x1f, 0x15, 0x15, 0x0a, 0x00},
    ['C'] = {0x0e, 0x11, 0x11, 0x11, 0x00}, ['D'] = {0x1f, 0x11, 0x11, 0x0e, 0x00},
    ['E'] = {0x1f, 0x15, 0x15, 0x11, 0x00}, ['F'] = {0x1f, 0x05, 0x05, 0x01, 0x00},
    ['G'] = {0x0e, 0x11, 0x15, 0x1d, 0x00}, ['H'] = {0x1f, 0x04, 0x04, 0x1f, 0x00},
    ['I'] = {0x11, 0x1f, 0x11, 0x00, 0x00}, ['J'] = {0x08, 0x10, 0x10, 0x0f, 0x00},
    ['K'] = {0x1f, 0x04, 0x0a, 0x11, 0x00}, ['L'] = {0x1f, 0x10, 0x10, 0x10, 0x00},
    ['M'] = {0x1f, 0x02, 0x04, 0x02, 0x1f}, ['N'] = {0x1f, 0x02, 0x04, 0x1f, 0x00},
    ['O'] = {0x0e, 0x11, 0x11, 0x0e, 0x00}, ['P'] = {0x1f, 0x05, 0x05, 0x02, 0x00},
    ['Q'] = {0x0e, 0x11, 0x19, 0x1e, 0x00}, ['R'] = {0x1f, 0x05, 0x0d, 0x12, 0x00},
    ['S'] = {0x12, 0x15, 0x15, 0x09, 0x00}, ['T'] = {0x01, 0x1f, 0x01, 0x00, 0x00},
    ['U'] = {0x0f, 0x10, 0x10, 0x0f, 0x00}, ['V'] = {0x07, 0x08, 0x10, 0x08, 0x07},
    ['W'] = {0x1f, 0x08, 0x04, 0x08, 0x1f}, ['X'] = {0x11, 0x0a, 0x04, 0x0a, 0x11},
    ['Y'] = {0x03, 0x04, 0x18, 0x04, 0x03}, ['Z'] = {0x19, 0x15, 0x13, 0x00, 0x00},
};

static void glyph(uint8_t *fb, int x, int y, char c) {
    unsigned char code = (unsigned char)c;
    if (code >= 'a' && code <= 'z') code = (unsigned char)(code - 'a' + 'A');
    const uint8_t *g = glyphs[code < 128 ? code : '?'];
    for (int col = 0; col < 5; col++) {
        for (int row = 0; row < 7; row++) {
            if (g[col] & (1u << row)) set_pixel(fb, x + col, y + row, NOTE4C_BLACK);
        }
    }
}

static void text(uint8_t *fb, int x, int y, const char *value, int max_chars) {
    for (int i = 0; value && value[i] && i < max_chars; i++) glyph(fb, x + i * 6, y, value[i]);
}

static void separator(uint8_t *fb, int y) {
    for (int x = 0; x < NOTE4C_WIDTH; x += 2) set_pixel(fb, x, y, NOTE4C_BLACK);
}

void todo_ui_render(const todo_model_t *model, uint8_t *framebuffer) {
    memset(framebuffer, 0x55, NOTE4C_FRAME_BYTES);
    text(framebuffer, 12, 12, "MEMORILO / TODO", 30);
    text(framebuffer, 286, 12, "2026-09-01", 18);
    separator(framebuffer, 28);

    const int first_y = 48;
    const int row_h = 35;
    for (size_t i = 0; model && i < model->count; i++) {
        const todo_item_t *item = &model->items[i];
        const int y = first_y + (int)i * row_h;
        if (i == model->selected) {
            box(framebuffer, 5, y - 5, 390, 29, false, NOTE4C_RED);
            box(framebuffer, 7, y - 3, 4, 25, true, NOTE4C_RED);
        }
        const int left = 18 + (int)item->indent * 18;
        box(framebuffer, left, y, 14, 14, item->status == TODO_DONE,
            item->status == TODO_DONE ? NOTE4C_BLACK : NOTE4C_YELLOW);
        text(framebuffer, left + 22, y + 2, item->title, 42 - item->indent * 3);
        if (item->due && item->due[0]) text(framebuffer, 330, y + 2, item->due, 10);
        if (item->status == TODO_DOING) text(framebuffer, left + 22, y + 13, "DOING", 8);
    }
    separator(framebuffer, 275);
    text(framebuffer, 12, 282, "UP/DOWN SELECT   OK TOGGLE", 40);
}
