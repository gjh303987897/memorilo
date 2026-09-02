#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    TODO_OPEN = 0,
    TODO_DOING,
    TODO_DONE,
} todo_status_t;

typedef struct {
    const char *title;
    const char *due;
    todo_status_t status;
    uint8_t indent;
} todo_item_t;

typedef struct {
    todo_item_t *items;
    size_t count;
    size_t selected;
} todo_model_t;

void todo_model_init(todo_model_t *model);
void todo_model_move(todo_model_t *model, int delta);
void todo_model_toggle_selected(todo_model_t *model);
const todo_item_t *todo_model_selected(const todo_model_t *model);
