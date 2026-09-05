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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TodoModel {
    pub items: Vec<TodoItem>,
}

impl Default for TodoModel {
    fn default() -> Self {
        Self {
            items: vec![
                TodoItem {
                    id: TodoId("demo-1".into()),
                    title: "同步设计评审".into(),
                    due: "09:30".into(),
                    status: Status::Done,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId("demo-2".into()),
                    title: "准备设备原型".into(),
                    due: "11:00".into(),
                    status: Status::Doing,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId("demo-3".into()),
                    title: "Wire display adapter".into(),
                    due: "today".into(),
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    id: TodoId("demo-4".into()),
                    title: "验证按键去抖".into(),
                    due: String::new(),
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    id: TodoId("demo-5".into()),
                    title: "Write demo notes".into(),
                    due: "tomorrow".into(),
                    status: Status::Open,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId("demo-6".into()),
                    title: "Archive old sketches".into(),
                    due: String::new(),
                    status: Status::Done,
                    indent: 0,
                },
            ],
        }
    }
}
