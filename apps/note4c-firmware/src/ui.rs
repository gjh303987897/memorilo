use crate::framebuffer::{Color, FRAME_BYTES, WIDTH, set_pixel};
use crate::model::{Status, TodoModel};

fn box_shape(framebuffer: &mut [u8], x: i32, y: i32, w: i32, h: i32, filled: bool, color: Color) {
    for yy in 0..h {
        for xx in 0..w {
            if filled || yy == 0 || yy == h - 1 || xx == 0 || xx == w - 1 {
                set_pixel(framebuffer, x + xx, y + yy, color);
            }
        }
    }
}

fn glyph_columns(value: char) -> [u8; 5] {
    match value.to_ascii_uppercase() {
        ' ' => [0, 0, 0, 0, 0],
        '?' => [0x1e, 0x05, 0x05, 0x15, 0x0e],
        '-' => [0x08, 0x08, 0x08, 0x08, 0x08],
        '/' => [0x10, 0x08, 0x04, 0x02, 0x01],
        ':' => [0, 0x14, 0, 0x14, 0],
        '0' => [0x0e, 0x11, 0x11, 0x11, 0x0e],
        '1' => [0x00, 0x12, 0x1f, 0x10, 0x00],
        '2' => [0x12, 0x19, 0x15, 0x12, 0x00],
        '3' => [0x11, 0x15, 0x15, 0x0a, 0x00],
        '4' => [0x07, 0x04, 0x1f, 0x04, 0x00],
        '5' => [0x17, 0x15, 0x15, 0x09, 0x00],
        '6' => [0x0e, 0x15, 0x15, 0x08, 0x00],
        '7' => [0x01, 0x01, 0x19, 0x07, 0x00],
        '8' => [0x0a, 0x15, 0x15, 0x0a, 0x00],
        '9' => [0x02, 0x15, 0x15, 0x0e, 0x00],
        'A' => [0x1e, 0x05, 0x05, 0x1e, 0x00],
        'B' => [0x1f, 0x15, 0x15, 0x0a, 0x00],
        'C' => [0x0e, 0x11, 0x11, 0x11, 0x00],
        'D' => [0x1f, 0x11, 0x11, 0x0e, 0x00],
        'E' => [0x1f, 0x15, 0x15, 0x11, 0x00],
        'F' => [0x1f, 0x05, 0x05, 0x01, 0x00],
        'G' => [0x0e, 0x11, 0x15, 0x1d, 0x00],
        'H' => [0x1f, 0x04, 0x04, 0x1f, 0x00],
        'I' => [0x11, 0x1f, 0x11, 0x00, 0x00],
        'J' => [0x08, 0x10, 0x10, 0x0f, 0x00],
        'K' => [0x1f, 0x04, 0x0a, 0x11, 0x00],
        'L' => [0x1f, 0x10, 0x10, 0x10, 0x00],
        'M' => [0x1f, 0x02, 0x04, 0x02, 0x1f],
        'N' => [0x1f, 0x02, 0x04, 0x1f, 0x00],
        'O' => [0x0e, 0x11, 0x11, 0x0e, 0x00],
        'P' => [0x1f, 0x05, 0x05, 0x02, 0x00],
        'Q' => [0x0e, 0x11, 0x19, 0x1e, 0x00],
        'R' => [0x1f, 0x05, 0x0d, 0x12, 0x00],
        'S' => [0x12, 0x15, 0x15, 0x09, 0x00],
        'T' => [0x01, 0x1f, 0x01, 0x00, 0x00],
        'U' => [0x0f, 0x10, 0x10, 0x0f, 0x00],
        'V' => [0x07, 0x08, 0x10, 0x08, 0x07],
        'W' => [0x1f, 0x08, 0x04, 0x08, 0x1f],
        'X' => [0x11, 0x0a, 0x04, 0x0a, 0x11],
        'Y' => [0x03, 0x04, 0x18, 0x04, 0x03],
        'Z' => [0x19, 0x15, 0x13, 0x00, 0x00],
        _ => [0x1e, 0x05, 0x05, 0x15, 0x0e],
    }
}

fn glyph(framebuffer: &mut [u8], x: i32, y: i32, value: char) {
    for (column, bits) in glyph_columns(value).into_iter().enumerate() {
        for row in 0..7 {
            if bits & (1 << row) != 0 {
                set_pixel(framebuffer, x + column as i32, y + row, Color::Black);
            }
        }
    }
}

fn text(framebuffer: &mut [u8], x: i32, y: i32, value: &str, max_chars: usize) {
    for (index, character) in value.chars().take(max_chars).enumerate() {
        glyph(framebuffer, x + index as i32 * 6, y, character);
    }
}

fn separator(framebuffer: &mut [u8], y: i32) {
    for x in (0..WIDTH).step_by(2) {
        set_pixel(framebuffer, x as i32, y, Color::Black);
    }
}

pub fn render(model: &TodoModel, framebuffer: &mut [u8]) {
    assert_eq!(framebuffer.len(), FRAME_BYTES);
    framebuffer.fill(0x55);
    text(framebuffer, 12, 12, "MEMORILO / TODO", 30);
    text(framebuffer, 286, 12, "2026-09-01", 18);
    separator(framebuffer, 28);

    for (index, item) in model.items.iter().enumerate() {
        let y = 48 + index as i32 * 35;
        if index == model.selected {
            box_shape(framebuffer, 5, y - 5, 390, 29, false, Color::Red);
            box_shape(framebuffer, 7, y - 3, 4, 25, true, Color::Red);
        }

        let left = 18 + item.indent as i32 * 18;
        box_shape(
            framebuffer,
            left,
            y,
            14,
            14,
            item.status == Status::Done,
            if item.status == Status::Done {
                Color::Black
            } else {
                Color::Yellow
            },
        );
        text(
            framebuffer,
            left + 22,
            y + 2,
            item.title,
            42 - item.indent as usize * 3,
        );
        if !item.due.is_empty() {
            text(framebuffer, 330, y + 2, item.due, 10);
        }
        if item.status == Status::Doing {
            text(framebuffer, left + 22, y + 13, "DOING", 8);
        }
    }

    separator(framebuffer, 275);
    text(framebuffer, 12, 282, "UP/DOWN SELECT   OK TOGGLE", 40);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framebuffer::color_at;

    #[test]
    fn selected_row_has_a_red_border() {
        let model = TodoModel::default();
        let mut framebuffer = vec![0; FRAME_BYTES];
        render(&model, &mut framebuffer);

        let selected_y = 48 + model.selected * 35 - 5;
        assert_eq!(color_at(&framebuffer, 5, selected_y), Color::Red);
    }
}
