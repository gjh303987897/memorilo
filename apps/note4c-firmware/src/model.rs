use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Status {
    Open,
    Doing,
    Done,
}

/// Opaque identity assigned by the authoritative TODO projection.
///
/// The firmware never interprets this value or derives authorization from it.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct TodoId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TodoItem {
    pub id: TodoId,
    pub title: String,
    pub due: String,
    pub status: Status,
    pub indent: u8,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct TodoModel {
    pub items: Vec<TodoItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_todo_model_is_empty() {
        assert!(TodoModel::default().items.is_empty());
    }
}
