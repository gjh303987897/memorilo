#include "note4c_display.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "zectrix_note4c_epd.h"

#ifdef CONFIG_NOTE4C_FAKE_DISPLAY
#define NOTE4C_FAKE_DISPLAY_ENABLED true
#else
#define NOTE4C_FAKE_DISPLAY_ENABLED false
#endif

_Static_assert(NOTE4C_FRAME_BYTES == ZECTRIX_NOTE4C_EPD_FRAME_BYTES,
               "NOTE4C framebuffer size must match the SSD2683 driver");

struct note4c_display {
    bool fake;
    uint8_t *shadow;
    zectrix_note4c_epd_t *epd;
};

static const char *TAG = "note4c-display";

esp_err_t note4c_display_init(note4c_display_t **out_display) {
    if (!out_display) return ESP_ERR_INVALID_ARG;
    note4c_display_t *display = calloc(1, sizeof(*display));
    if (!display) return ESP_ERR_NO_MEM;

    display->fake = NOTE4C_FAKE_DISPLAY_ENABLED;
    if (display->fake) {
        display->shadow = malloc(NOTE4C_FRAME_BYTES);
        if (!display->shadow) {
            free(display);
            return ESP_ERR_NO_MEM;
        }
        memset(display->shadow, 0x55, NOTE4C_FRAME_BYTES);
        ESP_LOGW(TAG, "fake NOTE4C BWRY backend; no panel commands will be sent");
    } else {
        const zectrix_note4c_epd_config_t config = ZECTRIX_NOTE4C_EPD_CONFIG_DEFAULT();
        const esp_err_t err = zectrix_note4c_epd_new(&config, &display->epd);
        if (err != ESP_OK) {
            free(display);
            return err;
        }
        ESP_LOGW(TAG, "real NOTE4C SSD2683 backend enabled");
    }

    *out_display = display;
    return ESP_OK;
}

esp_err_t note4c_display_refresh(note4c_display_t *display,
                                 const uint8_t *framebuffer,
                                 size_t size) {
    if (!display || !framebuffer || size != NOTE4C_FRAME_BYTES) return ESP_ERR_INVALID_ARG;
    if (!display->fake) {
        return zectrix_note4c_epd_refresh(display->epd, framebuffer, size);
    }

    memcpy(display->shadow, framebuffer, size);
    uint32_t counts[4] = {0};
    for (size_t i = 0; i < size; i++) {
        counts[(framebuffer[i] >> 6) & 3]++;
        counts[(framebuffer[i] >> 4) & 3]++;
        counts[(framebuffer[i] >> 2) & 3]++;
        counts[framebuffer[i] & 3]++;
    }
    ESP_LOGI(TAG, "fake BWRY refresh: black=%u white=%u yellow=%u red=%u",
             (unsigned)counts[0], (unsigned)counts[1],
             (unsigned)counts[2], (unsigned)counts[3]);
    return ESP_OK;
}

void note4c_display_deinit(note4c_display_t *display) {
    if (!display) return;
    zectrix_note4c_epd_delete(display->epd);
    free(display->shadow);
    free(display);
}
