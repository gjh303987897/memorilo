#include "todo_model.h"
#include "todo_data_source.h"

void todo_model_init(todo_model_t *model) {
    if (!model) return;
    todo_data_source_load(&model->items, &model->count);
    model->selected = model->count > 1 ? 1 : 0;
}

void todo_model_move(todo_model_t *model, int delta) {
    if (!model || model->count == 0 || delta == 0) return;
    int next = (int)model->selected + delta;
    if (next < 0) next = (int)model->count - 1;
    if (next >= (int)model->count) next = 0;
    model->selected = (size_t)next;
}

void todo_model_toggle_selected(todo_model_t *model) {
    if (!model || model->count == 0) return;
    todo_item_t *item = &model->items[model->selected];
    item->status = item->status == TODO_DONE ? TODO_OPEN : TODO_DONE;
}

const todo_item_t *todo_model_selected(const todo_model_t *model) {
    if (!model || model->count == 0) return 0;
    return &model->items[model->selected];
}
