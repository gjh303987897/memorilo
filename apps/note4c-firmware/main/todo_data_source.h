#pragma once

#include "todo_model.h"

/* The firmware-facing seam for TODO data. Replace the fake implementation
 * with HTTPS/CBOR later without changing the model or renderer. */
void todo_data_source_load(todo_item_t **items, size_t *count);
