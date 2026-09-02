idf_component_register(
    SRCS "zectrix_note4c_epd.c"
    INCLUDE_DIRS "include"
    REQUIRES driver esp_timer freertos log
)
