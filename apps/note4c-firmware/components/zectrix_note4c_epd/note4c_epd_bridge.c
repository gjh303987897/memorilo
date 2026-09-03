#include "note4c_epd_bridge.h"

#include <stdlib.h>

#include "zectrix_note4c_epd.h"

struct note4c_epd_bridge {
    zectrix_note4c_epd_t *epd;
};

esp_err_t note4c_epd_bridge_new(note4c_epd_bridge_t **out_display) {
    if (!out_display) return ESP_ERR_INVALID_ARG;

    note4c_epd_bridge_t *display = calloc(1, sizeof(*display));
    if (!display) return ESP_ERR_NO_MEM;

    const zectrix_note4c_epd_config_t config = ZECTRIX_NOTE4C_EPD_CONFIG_DEFAULT();
    const esp_err_t err = zectrix_note4c_epd_new(&config, &display->epd);
    if (err != ESP_OK) {
        free(display);
        return err;
    }

    *out_display = display;
    return ESP_OK;
}

esp_err_t note4c_epd_bridge_refresh(note4c_epd_bridge_t *display,
                                    const uint8_t *framebuffer,
                                    size_t size) {
    if (!display) return ESP_ERR_INVALID_ARG;
    return zectrix_note4c_epd_refresh(display->epd, framebuffer, size);
}

void note4c_epd_bridge_delete(note4c_epd_bridge_t *display) {
    if (!display) return;
    zectrix_note4c_epd_delete(display->epd);
    free(display);
}
