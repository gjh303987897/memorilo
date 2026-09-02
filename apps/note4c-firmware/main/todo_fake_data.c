#include "todo_data_source.h"

static todo_item_t fake_items[] = {
    {"Review sync design", "09:30", TODO_DONE, 0},
    {"Prepare NOTE4C prototype", "11:00", TODO_DOING, 0},
    {"Wire SSD2683 adapter", "today", TODO_OPEN, 1},
    {"Verify button debounce", "", TODO_OPEN, 1},
    {"Write demo notes", "tomorrow", TODO_OPEN, 0},
    {"Archive old sketches", "", TODO_DONE, 0},
};

void todo_data_source_load(todo_item_t **items, size_t *count) {
    if (items) *items = fake_items;
    if (count) *count = sizeof(fake_items) / sizeof(fake_items[0]);
}
