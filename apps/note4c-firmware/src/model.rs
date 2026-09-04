use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Status {
    Open,
    Doing,
    Done,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct TodoId(pub u64);

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
    #[serde(default)]
    pub selected: usize,
}

impl TodoModel {
    pub fn move_selection(&mut self, delta: isize) {
        if self.items.is_empty() || delta == 0 {
            return;
        }
        self.selected =
            (self.selected as isize + delta).rem_euclid(self.items.len() as isize) as usize;
    }
}

impl Default for TodoModel {
    fn default() -> Self {
        Self {
            items: vec![
                TodoItem {
                    id: TodoId(1),
                    title: "同步设计评审".into(),
                    due: "09:30".into(),
                    status: Status::Done,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId(2),
                    title: "准备设备原型".into(),
                    due: "11:00".into(),
                    status: Status::Doing,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId(3),
                    title: "Wire display adapter".into(),
                    due: "today".into(),
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    id: TodoId(4),
                    title: "验证按键去抖".into(),
                    due: String::new(),
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    id: TodoId(5),
                    title: "Write demo notes".into(),
                    due: "tomorrow".into(),
                    status: Status::Open,
                    indent: 0,
                },
                TodoItem {
                    id: TodoId(6),
                    title: "Archive old sketches".into(),
                    due: String::new(),
                    status: Status::Done,
                    indent: 0,
                },
            ],
            selected: 1,
        }
    }
}
