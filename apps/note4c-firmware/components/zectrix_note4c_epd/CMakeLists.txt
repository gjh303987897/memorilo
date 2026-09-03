idf_component_register(
    SRCS "zectrix_note4c_epd.c" "note4c_epd_bridge.c"
    INCLUDE_DIRS "include"
    REQUIRES driver esp_timer freertos log
)
