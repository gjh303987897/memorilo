pub const WIDTH: usize = 400;
pub const HEIGHT: usize = 300;
pub const FRAME_BYTES: usize = WIDTH * HEIGHT / 4;
const ROW_BYTES: usize = WIDTH / 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Color {
    Black = 0,
    White = 1,
    Yellow = 2,
    Red = 3,
}

pub fn set_pixel(framebuffer: &mut [u8], x: i32, y: i32, color: Color) {
    if x < 0 || y < 0 || x as usize >= WIDTH || y as usize >= HEIGHT {
        return;
    }

    let byte = &mut framebuffer[y as usize * ROW_BYTES + x as usize / 4];
    let shift = 6 - ((x as usize & 3) * 2);
    *byte = (*byte & !(3 << shift)) | ((color as u8) << shift);
}

pub fn color_at(framebuffer: &[u8], x: usize, y: usize) -> Color {
    let byte = framebuffer[y * ROW_BYTES + x / 4];
    match (byte >> (6 - ((x & 3) * 2))) & 3 {
        0 => Color::Black,
        1 => Color::White,
        2 => Color::Yellow,
        _ => Color::Red,
    }
}

pub fn render_color_test(framebuffer: &mut [u8]) {
    const COLORS: [Color; 4] = [Color::Black, Color::White, Color::Red, Color::Yellow];
    let bar_width = WIDTH / COLORS.len();

    for y in 0..HEIGHT {
        for (bar, color) in COLORS.into_iter().enumerate() {
            for x in bar * bar_width..(bar + 1) * bar_width {
                set_pixel(framebuffer, x as i32, y as i32, color);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_test_uses_the_expected_left_to_right_order() {
        let mut framebuffer = vec![0; FRAME_BYTES];
        render_color_test(&mut framebuffer);

        assert_eq!(color_at(&framebuffer, 0, 150), Color::Black);
        assert_eq!(color_at(&framebuffer, 100, 150), Color::White);
        assert_eq!(color_at(&framebuffer, 200, 150), Color::Red);
        assert_eq!(color_at(&framebuffer, 300, 150), Color::Yellow);
    }
}
