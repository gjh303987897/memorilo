set(srcs
    app_main.c
    note4c_board.c
    note4c_display.c
    note4c_test_pattern.c
    todo_fake_data.c
    todo_model.c
    todo_ui.c
)

set(requires driver esp_timer freertos log zectrix_note4c_epd)

idf_component_register(
    SRCS ${srcs}
    INCLUDE_DIRS "."
    REQUIRES ${requires}
)
