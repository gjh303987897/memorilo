#pragma once

#include <stdint.h>
#include "todo_model.h"

void todo_ui_render(const todo_model_t *model, uint8_t *framebuffer);
