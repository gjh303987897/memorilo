#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
    Doing,
    Done,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TodoItem {
    pub title: &'static str,
    pub due: &'static str,
    pub status: Status,
    pub indent: u8,
}

#[derive(Debug)]
pub struct TodoModel {
    pub items: Vec<TodoItem>,
    pub selected: usize,
}

impl Default for TodoModel {
    fn default() -> Self {
        Self {
            items: vec![
                TodoItem {
                    title: "Review sync design",
                    due: "09:30",
                    status: Status::Done,
                    indent: 0,
                },
                TodoItem {
                    title: "Prepare device prototype",
                    due: "11:00",
                    status: Status::Doing,
                    indent: 0,
                },
                TodoItem {
                    title: "Wire display adapter",
                    due: "today",
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    title: "Verify button debounce",
                    due: "",
                    status: Status::Open,
                    indent: 1,
                },
                TodoItem {
                    title: "Write demo notes",
                    due: "tomorrow",
                    status: Status::Open,
                    indent: 0,
                },
                TodoItem {
                    title: "Archive old sketches",
                    due: "",
                    status: Status::Done,
                    indent: 0,
                },
            ],
            selected: 1,
        }
    }
}

impl TodoModel {
    pub fn move_selection(&mut self, delta: isize) {
        if self.items.is_empty() || delta == 0 {
            return;
        }

        self.selected =
            (self.selected as isize + delta).rem_euclid(self.items.len() as isize) as usize;
    }

    pub fn toggle_selected(&mut self) {
        let Some(item) = self.items.get_mut(self.selected) else {
            return;
        };
        item.status = if item.status == Status::Done {
            Status::Open
        } else {
            Status::Done
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_wraps_in_both_directions() {
        let mut model = TodoModel {
            selected: 0,
            ..TodoModel::default()
        };
        model.move_selection(-1);
        assert_eq!(model.selected, model.items.len() - 1);
        model.move_selection(1);
        assert_eq!(model.selected, 0);
    }

    #[test]
    fn toggle_reopens_done_items_and_completes_other_items() {
        let mut model = TodoModel {
            selected: 0,
            ..TodoModel::default()
        };
        model.toggle_selected();
        assert_eq!(model.items[0].status, Status::Open);
        model.toggle_selected();
        assert_eq!(model.items[0].status, Status::Done);
    }
}
