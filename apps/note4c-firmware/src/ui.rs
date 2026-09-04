use std::convert::Infallible;
use std::ops::Range;

use embedded_graphics_core::Pixel;
use embedded_graphics_core::geometry::{OriginDimensions, Point, Size};
use embedded_graphics_core::prelude::DrawTarget;
use u8g2_fonts::FontRenderer;
use u8g2_fonts::fonts::u8g2_font_wqy12_t_gb2312;
use u8g2_fonts::types::{FontColor, VerticalPosition};

use crate::application::{ApplicationSnapshot, PageId};
use crate::device_status::{ChargeState, RtcStatus};
use crate::framebuffer::{Color, FRAME_BYTES, HEIGHT, WIDTH, set_pixel};
use crate::glance::{GregorianDate, WeatherCondition, WeatherPhase, calendar_month, is_leap_year};
use crate::model::Status;
use crate::provisioning::ProvisioningPhase;

const FONT: FontRenderer = FontRenderer::new::<u8g2_font_wqy12_t_gb2312>();
const LINE_HEIGHT: i32 = 14;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Bounds {
    pub const SCREEN: Self = Self {
        x: 0,
        y: 0,
        width: WIDTH as i32,
        height: HEIGHT as i32,
    };

    pub const fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.y >= self.y
            && point.x < self.x + self.width
            && point.y < self.y + self.height
    }

    fn intersect(self, other: Self) -> Self {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        Self::new(x, y, (right - x).max(0), (bottom - y).max(0))
    }

    fn inset(self, amount: i32) -> Self {
        Self::new(
            self.x + amount,
            self.y + amount,
            (self.width - amount * 2).max(0),
            (self.height - amount * 2).max(0),
        )
    }
}

pub struct Canvas<'a> {
    framebuffer: &'a mut [u8],
    clip: Bounds,
}

impl<'a> Canvas<'a> {
    pub fn new(framebuffer: &'a mut [u8]) -> Self {
        assert_eq!(framebuffer.len(), FRAME_BYTES);
        Self {
            framebuffer,
            clip: Bounds::SCREEN,
        }
    }

    pub fn clear(&mut self, color: Color) {
        self.fill_rect(Bounds::SCREEN, color);
    }

    pub fn fill_rect(&mut self, bounds: Bounds, color: Color) {
        let bounds = bounds.intersect(self.clip).intersect(Bounds::SCREEN);
        for y in bounds.y..bounds.y + bounds.height {
            for x in bounds.x..bounds.x + bounds.width {
                set_pixel(self.framebuffer, x, y, color);
            }
        }
    }

    pub fn stroke_rect(&mut self, bounds: Bounds, width: i32, color: Color) {
        for offset in 0..width.max(0) {
            let current = bounds.inset(offset);
            if current.width <= 0 || current.height <= 0 {
                return;
            }
            self.fill_rect(Bounds::new(current.x, current.y, current.width, 1), color);
            self.fill_rect(
                Bounds::new(current.x, current.y + current.height - 1, current.width, 1),
                color,
            );
            self.fill_rect(Bounds::new(current.x, current.y, 1, current.height), color);
            self.fill_rect(
                Bounds::new(current.x + current.width - 1, current.y, 1, current.height),
                color,
            );
        }
    }

    pub fn with_clip(&mut self, clip: Bounds, draw: impl FnOnce(&mut Self)) {
        let previous = self.clip;
        self.clip = self.clip.intersect(clip);
        draw(self);
        self.clip = previous;
    }
}

impl OriginDimensions for Canvas<'_> {
    fn size(&self) -> Size {
        Size::new(WIDTH as u32, HEIGHT as u32)
    }
}

impl DrawTarget for Canvas<'_> {
    type Color = Color;
    type Error = Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(point, color) in pixels {
            if self.clip.contains(point) {
                set_pixel(self.framebuffer, point.x, point.y, color);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Theme {
    pub background: Color,
    pub text: Color,
    pub muted: Color,
    pub accent: Color,
    pub warning: Color,
    pub selection: Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            background: Color::White,
            text: Color::Black,
            muted: Color::Yellow,
            accent: Color::Red,
            warning: Color::Yellow,
            selection: Color::Red,
        }
    }
}

pub struct BitmapFont;

impl BitmapFont {
    pub fn supports(character: char) -> bool {
        FONT.get_rendered_dimensions(character, Point::zero(), VerticalPosition::Top)
            .is_ok()
    }

    pub fn measure(text: &str) -> i32 {
        text.chars().map(Self::glyph_advance).sum()
    }

    pub fn draw(canvas: &mut Canvas<'_>, position: Point, text: &str, color: Color) -> i32 {
        let mut x = position.x;
        for character in text.chars() {
            let glyph = if Self::supports(character) {
                character
            } else {
                '?'
            };
            let dimensions = FONT
                .render(
                    glyph,
                    Point::new(x, position.y),
                    VerticalPosition::Top,
                    FontColor::Transparent(color),
                    canvas,
                )
                .expect("framebuffer draw target cannot fail");
            x += dimensions.advance.x;
        }
        x - position.x
    }

    fn glyph_advance(character: char) -> i32 {
        let glyph = if Self::supports(character) {
            character
        } else {
            '?'
        };
        FONT.get_rendered_dimensions(glyph, Point::zero(), VerticalPosition::Top)
            .expect("fallback glyph must exist")
            .advance
            .x
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TextLine {
    pub text: String,
    pub width: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrappedText {
    pub lines: Vec<TextLine>,
    pub truncated: bool,
}

pub fn wrap_text(text: &str, maximum_width: i32, maximum_lines: usize) -> WrappedText {
    if maximum_lines == 0 {
        return WrappedText {
            lines: Vec::new(),
            truncated: !text.is_empty(),
        };
    }

    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0;
    let mut truncated = false;

    for character in text.chars() {
        if character == '\n' {
            lines.push(TextLine {
                text: std::mem::take(&mut current),
                width: current_width,
            });
            current_width = 0;
            if lines.len() == maximum_lines {
                truncated = true;
                break;
            }
            continue;
        }

        let advance = BitmapFont::glyph_advance(character);
        if !current.is_empty() && current_width + advance > maximum_width {
            lines.push(TextLine {
                text: std::mem::take(&mut current),
                width: current_width,
            });
            current_width = 0;
            if lines.len() == maximum_lines {
                truncated = true;
                break;
            }
        }
        current.push(character);
        current_width += advance;
    }

    if !current.is_empty() && lines.len() < maximum_lines {
        lines.push(TextLine {
            text: current,
            width: current_width,
        });
    }

    WrappedText { lines, truncated }
}

pub fn page_ranges(line_count: usize, lines_per_page: usize) -> Vec<Range<usize>> {
    assert!(lines_per_page > 0);
    (0..line_count)
        .step_by(lines_per_page)
        .map(|start| start..(start + lines_per_page).min(line_count))
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListViewport {
    pub visible: Range<usize>,
}

impl ListViewport {
    pub fn around(item_count: usize, selected: usize, capacity: usize) -> Self {
        if item_count == 0 || capacity == 0 {
            return Self { visible: 0..0 };
        }
        let selected = selected.min(item_count - 1);
        let capacity = capacity.min(item_count);
        let first = selected
            .saturating_sub(capacity / 2)
            .min(item_count - capacity);
        Self {
            visible: first..first + capacity,
        }
    }

    pub fn visual_row(&self, item_index: usize) -> Option<usize> {
        self.visible
            .contains(&item_index)
            .then(|| item_index - self.visible.start)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusTone {
    Neutral,
    Warning,
    Accent,
}

pub struct RawDraw<'a> {
    canvas: Canvas<'a>,
    theme: Theme,
}

impl<'a> RawDraw<'a> {
    pub fn new(framebuffer: &'a mut [u8], theme: Theme) -> Self {
        Self {
            canvas: Canvas::new(framebuffer),
            theme,
        }
    }

    pub fn clear(&mut self) {
        self.canvas.clear(self.theme.background);
    }

    pub fn text(&mut self, position: Point, value: &str, color: Color) -> i32 {
        BitmapFont::draw(&mut self.canvas, position, value, color)
    }

    pub fn wrapped_text(
        &mut self,
        bounds: Bounds,
        value: &str,
        maximum_lines: usize,
        color: Color,
    ) -> WrappedText {
        let layout = wrap_text(value, bounds.width, maximum_lines);
        self.canvas.with_clip(bounds, |canvas| {
            for (line, layout_line) in layout.lines.iter().enumerate() {
                BitmapFont::draw(
                    canvas,
                    Point::new(bounds.x, bounds.y + line as i32 * LINE_HEIGHT),
                    &layout_line.text,
                    color,
                );
            }
        });
        layout
    }

    pub fn separator(&mut self, y: i32) {
        for x in (0..WIDTH as i32).step_by(2) {
            self.canvas
                .fill_rect(Bounds::new(x, y, 1, 1), self.theme.text);
        }
    }

    pub fn list_row(&mut self, bounds: Bounds, selected: bool) -> Bounds {
        if selected {
            self.selection(bounds);
        }
        bounds.inset(5)
    }

    pub fn selection(&mut self, bounds: Bounds) {
        self.canvas.stroke_rect(bounds, 2, self.theme.selection);
        self.canvas.fill_rect(
            Bounds::new(bounds.x + 2, bounds.y + 2, 3, bounds.height - 4),
            self.theme.selection,
        );
    }

    pub fn checkbox(&mut self, bounds: Bounds, checked: bool) {
        self.canvas.stroke_rect(bounds, 2, self.theme.text);
        if checked {
            self.canvas.fill_rect(bounds.inset(4), self.theme.text);
        }
    }

    pub fn progress(&mut self, bounds: Bounds, value: u32, maximum: u32) {
        self.canvas.stroke_rect(bounds, 1, self.theme.text);
        let inner = bounds.inset(2);
        let filled = if maximum == 0 {
            0
        } else {
            (inner.width as i64 * i64::from(value.min(maximum)) / i64::from(maximum)) as i32
        };
        self.canvas.fill_rect(
            Bounds::new(inner.x, inner.y, filled, inner.height),
            self.theme.accent,
        );
    }

    pub fn status(&mut self, bounds: Bounds, label: &str, tone: StatusTone) {
        let color = match tone {
            StatusTone::Neutral => self.theme.text,
            StatusTone::Warning => self.theme.warning,
            StatusTone::Accent => self.theme.accent,
        };
        self.canvas.stroke_rect(bounds, 1, color);
        self.canvas.with_clip(bounds.inset(2), |canvas| {
            BitmapFont::draw(
                canvas,
                Point::new(bounds.x + 3, bounds.y + 2),
                label,
                self.theme.text,
            );
        });
    }

    pub fn dialog(&mut self, bounds: Bounds, title: &str, body: &str) {
        self.canvas.fill_rect(bounds, self.theme.background);
        self.canvas.stroke_rect(bounds, 3, self.theme.accent);
        self.text(
            Point::new(bounds.x + 8, bounds.y + 8),
            title,
            self.theme.text,
        );
        self.wrapped_text(
            Bounds::new(
                bounds.x + 8,
                bounds.y + 28,
                bounds.width - 16,
                bounds.height - 36,
            ),
            body,
            ((bounds.height - 36) / LINE_HEIGHT).max(0) as usize,
            self.theme.text,
        );
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UiRenderMetadata {
    pub visible_items: Range<usize>,
    pub page_count: usize,
}

#[derive(Default)]
pub struct RawDrawUiManager {
    theme: Theme,
}

impl RawDrawUiManager {
    pub fn render(
        &self,
        snapshot: &ApplicationSnapshot,
        framebuffer: &mut [u8],
    ) -> UiRenderMetadata {
        let mut draw = RawDraw::new(framebuffer, self.theme);
        draw.clear();
        match snapshot.page {
            PageId::Todos => self.render_todos(snapshot, &mut draw),
            PageId::Gallery => self.render_gallery(snapshot, &mut draw),
            PageId::Calendar => self.render_calendar(snapshot, &mut draw),
            PageId::Weather => self.render_weather(snapshot, &mut draw),
            PageId::Provisioning => self.render_provisioning(snapshot, &mut draw),
            PageId::Diagnostics => self.render_diagnostics(snapshot, &mut draw),
        }
    }

    fn render_calendar(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / CALENDAR");
        draw.separator(30);
        let Some(today) = snapshot_date(snapshot) else {
            draw.wrapped_text(
                Bounds::new(24, 92, 352, 60),
                "日期尚未设置\n请先同步网络时间或设置 RTC",
                3,
                self.theme.text,
            );
            return UiRenderMetadata {
                visible_items: 0..0,
            page_count: 4,
            };
        };
        let shown = today.shifted_month(snapshot.glance.calendar_month_offset);
        let month = calendar_month(shown);
        draw.text(
            Point::new(14, 40),
            &format!("{} 年 {} 月", month.year, month.month),
            self.theme.text,
        );
        draw.text(
            Point::new(14, 61),
            "一     二     三     四     五     六     日",
            self.theme.muted,
        );
        for day in 1..=month.days {
            let cell = usize::from(month.first_weekday_monday_zero) + usize::from(day - 1);
            let column = cell % 7;
            let row = cell / 7;
            let x = 14 + column as i32 * 55;
            let y = 88 + row as i32 * 30;
            let is_today = snapshot.glance.calendar_month_offset == 0 && day == today.day;
            if is_today {
                draw.selection(Bounds::new(x - 4, y - 3, 38, 22));
            }
            draw.text(Point::new(x, y), &day.to_string(), self.theme.text);
        }
        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "短按上下键切换月份 / 长按上下键切换页面",
            self.theme.text,
        );
        UiRenderMetadata {
            visible_items: 0..usize::from(month.days),
            page_count: 4,
        }
    }

    #[allow(dead_code)]
    fn render_year_progress(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / YEAR PROGRESS");
        draw.separator(30);
        let Some(today) = snapshot_date(snapshot) else {
            draw.wrapped_text(
                Bounds::new(24, 92, 352, 60),
                "日期尚未设置\n年度进度将在时钟有效后显示",
                3,
                self.theme.text,
            );
            return UiRenderMetadata {
                visible_items: 0..0,
            page_count: 4,
            };
        };
        let elapsed = today.day_of_year();
        let total = if is_leap_year(today.year) { 366 } else { 365 };
        let basis_points = today.year_progress_basis_points();
        draw.text(
            Point::new(18, 54),
            &format!("{} 年已走过", today.year),
            self.theme.text,
        );
        draw.text(
            Point::new(18, 88),
            &format!("{}.{:02}%", basis_points / 100, basis_points % 100),
            self.theme.accent,
        );
        draw.progress(Bounds::new(18, 126, 364, 28), u32::from(elapsed), total);
        draw.text(
            Point::new(18, 172),
            &format!("第 {elapsed} 天 / 共 {total} 天"),
            self.theme.text,
        );
        draw.wrapped_text(
            Bounds::new(18, 205, 364, 42),
            "进度以本地日期的当天开始计算，仅在页面切换或其它正常刷新时更新。",
            3,
            self.theme.text,
        );
        draw.separator(276);
        draw.text(Point::new(10, 282), "长按上下键切换页面", self.theme.text);
        UiRenderMetadata {
            visible_items: 0..1,
            page_count: 4,
        }
    }

    fn render_weather(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / WEATHER");
        draw.separator(30);
        let weather = &snapshot.glance.weather;
        let location = if snapshot.config.weather.location_name.is_empty() {
            "LOCATION NOT SET"
        } else {
            snapshot.config.weather.location_name.as_str()
        };
        draw.text(Point::new(18, 50), location, self.theme.text);
        match (weather.phase, weather.reading.as_ref()) {
            (WeatherPhase::Fresh | WeatherPhase::Stale, Some(reading)) => {
                let tone = if weather.phase == WeatherPhase::Fresh {
                    self.theme.accent
                } else {
                    self.theme.warning
                };
                let tenths = reading.temperature_tenths_celsius;
                draw.text(
                    Point::new(18, 92),
                    &format!("{}.{:01} C", tenths / 10, tenths.abs() % 10),
                    tone,
                );
                draw.text(
                    Point::new(18, 128),
                    if reading.is_demo {
                        "DEMO DATA"
                    } else {
                        condition_label(reading.condition)
                    },
                    self.theme.text,
                );
                draw.text(
                    Point::new(18, 158),
                    &format!(
                        "HUM {}%  RAIN {}%",
                        reading.relative_humidity_percent,
                        reading.precipitation_probability_percent
                    ),
                    self.theme.text,
                );
                draw.wrapped_text(
                    Bounds::new(18, 194, 360, 42),
                    if weather.phase == WeatherPhase::Fresh {
                        "缓存数据在一小时内更新"
                    } else {
                        "天气数据已陈旧，仍显示最近一次缓存"
                    },
                    3,
                    tone,
                );
            }
            (WeatherPhase::Loading, _) => {
                draw.text(Point::new(18, 100), "正在获取天气...", self.theme.text);
            }
            (WeatherPhase::Failed, _) => {
                draw.wrapped_text(
                    Bounds::new(18, 94, 360, 60),
                    "天气暂不可用\n请检查网络或设置位置",
                    3,
                    self.theme.warning,
                );
            }
            (WeatherPhase::Disabled, _) => {
                draw.wrapped_text(
                    Bounds::new(18, 94, 360, 60),
                    "天气已关闭\n可在 Memorilo 设置中启用",
                    3,
                    self.theme.text,
                );
            }
            _ => {
                draw.wrapped_text(
                    Bounds::new(18, 94, 360, 60),
                    "尚无天气缓存\n联网后将按小时更新",
                    3,
                    self.theme.text,
                );
            }
        }
        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "天气仅作参考 / 长按上下键切换页面",
            self.theme.text,
        );
        UiRenderMetadata {
            visible_items: 0..1,
            page_count: 4,
        }
    }

    #[allow(dead_code)]
    fn render_almanac(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / ALMANAC");
        draw.separator(30);
        let config = &snapshot.config.almanac;
        draw.text(Point::new(18, 54), "PERSONAL NOTE", self.theme.muted);
        draw.wrapped_text(
            Bounds::new(18, 75, 360, 100),
            if config.note.is_empty() {
                "未设置黄历备注"
            } else {
                config.note.as_str()
            },
            3,
            self.theme.text,
        );
        draw.text(Point::new(18, 198), "SOURCE", self.theme.muted);
        draw.wrapped_text(
            Bounds::new(18, 219, 360, 36),
            if config.source.is_empty() {
                "未声明来源"
            } else {
                config.source.as_str()
            },
            2,
            self.theme.text,
        );
        draw.wrapped_text(
            Bounds::new(18, 250, 360, 26),
            "此页不是官方黄历，也不提供健康或决策建议。",
            2,
            self.theme.warning,
        );
        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "仅显示用户输入 / 长按上下键切换页面",
            self.theme.text,
        );
        UiRenderMetadata {
            visible_items: 0..1,
            page_count: 4,
        }
    }

    fn render_gallery(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / GALLERY");
        draw.separator(30);

        let catalog = &snapshot.gallery.catalog;
        if catalog.assets.is_empty() {
            draw.wrapped_text(
                Bounds::new(24, 82, 352, 80),
                "图库为空\n请在 Memorilo 设置中上传四色图片",
                3,
                self.theme.text,
            );
        } else {
            const CAPACITY: usize = 6;
            const ROW_HEIGHT: i32 = 38;
            let viewport =
                ListViewport::around(catalog.assets.len(), snapshot.gallery.selected, CAPACITY);
            for item_index in viewport.visible.clone() {
                let row = viewport
                    .visual_row(item_index)
                    .expect("visible gallery item must have a visual row");
                let asset = &catalog.assets[item_index];
                let bounds = Bounds::new(8, 38 + row as i32 * ROW_HEIGHT, 384, ROW_HEIGHT - 3);
                let content = draw.list_row(bounds, item_index == snapshot.gallery.selected);
                draw.wrapped_text(
                    Bounds::new(content.x + 5, content.y + 2, 285, 29),
                    &asset.name,
                    2,
                    self.theme.text,
                );
                draw.text(
                    Point::new(322, content.y + 2),
                    &format!("{:02}/{:02}", item_index + 1, catalog.assets.len()),
                    self.theme.text,
                );
            }
        }

        draw.separator(276);
        let footer = if let Some(error) = &snapshot.gallery.last_error {
            format!("图库错误: {error}")
        } else if let Some(seconds) = catalog.slideshow_interval_seconds {
            format!("确认全屏 / 幻灯片每 {} 分钟", seconds / 60)
        } else {
            format!(
                "确认全屏 / 已用 {} KiB / 100 张上限",
                catalog.used_bytes() / 1024
            )
        };
        draw.wrapped_text(Bounds::new(10, 280, 380, 18), &footer, 1, self.theme.text);

        UiRenderMetadata {
            visible_items: if catalog.assets.is_empty() {
                0..0
            } else {
                ListViewport::around(catalog.assets.len(), snapshot.gallery.selected, 6).visible
            },
            page_count: 4,
        }
    }

    fn render_todos(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        self.render_header(snapshot, draw, "MEMORILO / 待办");
        draw.separator(30);

        const CAPACITY: usize = 6;
        const ROW_HEIGHT: i32 = 38;
        let visible_items = 0..snapshot.todos.items.len().min(CAPACITY);
        for (row, item_index) in visible_items.clone().enumerate() {
            let item = &snapshot.todos.items[item_index];
            let bounds = Bounds::new(5, 38 + row as i32 * ROW_HEIGHT, 390, ROW_HEIGHT - 3);
            let content = draw.list_row(bounds, false);
            let checkbox = Bounds::new(content.x + item.indent as i32 * 14, content.y + 5, 14, 14);
            draw.checkbox(checkbox, item.status == Status::Done);
            let title_x = checkbox.x + checkbox.width + 7;
            draw.wrapped_text(
                Bounds::new(title_x, content.y + 2, 250, 29),
                &item.title,
                2,
                self.theme.text,
            );
            if !item.due.is_empty() {
                draw.text(Point::new(328, content.y + 2), &item.due, self.theme.text);
            }
            if item.status == Status::Doing {
                draw.status(
                    Bounds::new(328, content.y + 16, 50, 16),
                    "进行中",
                    StatusTone::Warning,
                );
            }
        }

        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "只读视图 / 内容和状态由 Memorilo 同步",
            self.theme.text,
        );

        UiRenderMetadata {
            visible_items,
            page_count: 4,
        }
    }

    fn render_provisioning(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        let (headline, detail) = match (
            snapshot.settings.provisioning.phase,
            snapshot.settings.provisioning.passkey,
        ) {
            (ProvisioningPhase::WaitingForDisplay, Some(passkey)) => (
                format!("配对码 {passkey:06}"),
                "请在 Memorilo 设置中连接设备",
            ),
            (ProvisioningPhase::Advertising, Some(passkey)) => {
                (format!("配对码 {passkey:06}"), "正在等待 Memorilo 连接")
            }
            (ProvisioningPhase::Connected, _) => {
                ("设备已连接".into(), "请在 Memorilo 中确认配对码")
            }
            (ProvisioningPhase::Authenticated, _) => {
                ("安全连接已建立".into(), "可在 Memorilo 中修改并应用设置")
            }
            (ProvisioningPhase::Applying, _) => {
                ("正在应用设置".into(), "请保持设备与 Memorilo 连接")
            }
            (ProvisioningPhase::Applied, _) => ("设置已同步".into(), "即将返回待办页面"),
            (ProvisioningPhase::Failed, _) => ("配对或同步失败".into(), "请在 Memorilo 中重试"),
            _ => ("等待配对".into(), "请在 Memorilo 设置中连接设备"),
        };

        self.render_header(snapshot, draw, "MEMORILO / 配对");
        draw.separator(30);
        draw.wrapped_text(
            Bounds::new(24, 82, 352, 58),
            &headline,
            2,
            self.theme.accent,
        );
        draw.wrapped_text(Bounds::new(24, 158, 352, 54), detail, 3, self.theme.text);
        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "长按确认键取消 / 设置仅在 Memorilo 中修改",
            self.theme.text,
        );

        UiRenderMetadata {
            visible_items: 0..1,
            page_count: 4,
        }
    }

    fn render_diagnostics(
        &self,
        snapshot: &ApplicationSnapshot,
        draw: &mut RawDraw<'_>,
    ) -> UiRenderMetadata {
        let diagnostics = &snapshot.diagnostics;
        let internal = format_memory_pair(
            diagnostics.free_internal_bytes,
            diagnostics.minimum_free_internal_bytes,
        );
        let psram = format_memory_pair(
            diagnostics.free_psram_bytes,
            diagnostics.minimum_free_psram_bytes,
        );
        let stack = format_memory(diagnostics.stack_high_water_bytes);
        let buttons = format!(
            "U{} O{} D{} / {}",
            u8::from(diagnostics.buttons[0]),
            u8::from(diagnostics.buttons[1]),
            u8::from(diagnostics.buttons[2]),
            diagnostics.last_input
        );
        let battery = match (
            snapshot.status.battery.millivolts,
            snapshot.status.battery.percent,
            snapshot.status.battery.charge,
        ) {
            (Some(millivolts), Some(percent), charge) => {
                format!("{millivolts}mV {percent}% {charge:?}")
            }
            _ => "unavailable".into(),
        };
        let rtc = match snapshot.status.rtc {
            RtcStatus::Valid(time) => format!(
                "{:04}-{:02}-{:02} {:02}:{:02}",
                time.year, time.month, time.day, time.hour, time.minute
            ),
            RtcStatus::Unset => "unset".into(),
            RtcStatus::Unavailable => "unavailable".into(),
        };
        let display = format!(
            "{:?} req{:?} shown{:?}",
            snapshot.display.phase,
            snapshot.display.requested_revision,
            snapshot.display.displayed_revision
        );
        let ble = format!(
            "{:?} / {:?}",
            snapshot
                .services
                .phase(crate::application::ServiceId::Provisioning),
            snapshot.settings.provisioning.phase
        );
        let wifi = format!(
            "{:?} / {:?}",
            snapshot
                .services
                .phase(crate::application::ServiceId::Network),
            snapshot.status.connection
        );
        let left = [
            ("BUILD", env!("CARGO_PKG_VERSION").to_owned()),
            ("UPTIME", format!("{} ms", diagnostics.uptime_ms)),
            ("INTERNAL free/min", internal),
            ("PSRAM free/min", psram),
            ("STACK margin", stack),
            ("BUTTONS / last", buttons),
        ];
        let right = [
            ("BATTERY", battery),
            ("RTC", rtc),
            ("DISPLAY", display),
            ("BLE", ble),
            ("WIFI", wifi),
            (
                "LAST ERROR",
                diagnostics.last_error.unwrap_or("none").to_owned(),
            ),
        ];

        self.render_header(snapshot, draw, "MEMORILO / DIAGNOSTICS");
        draw.separator(30);
        render_diagnostic_column(draw, 8, &left, self.theme);
        render_diagnostic_column(draw, 205, &right, self.theme);
        draw.separator(276);
        draw.text(
            Point::new(10, 282),
            "OK: back / UP or DOWN: resample",
            self.theme.text,
        );

        UiRenderMetadata {
            visible_items: 0..left.len() + right.len(),
            page_count: 4,
        }
    }

    fn render_header(&self, snapshot: &ApplicationSnapshot, draw: &mut RawDraw<'_>, title: &str) {
        draw.text(Point::new(10, 8), title, self.theme.text);
        if let RtcStatus::Valid(time) = snapshot.status.rtc {
            let date = format!("{:04}-{:02}-{:02}", time.year, time.month, time.day);
            draw.text(Point::new(260, 8), &date, self.theme.text);
        }
        let battery = match (
            snapshot.status.battery.percent,
            snapshot.status.battery.charge,
        ) {
            (Some(percent), ChargeState::Charging) => format!("{percent}%+"),
            (Some(percent), ChargeState::Full) => format!("{percent}%F"),
            (Some(percent), _) => format!("{percent}%"),
            (None, _) => "--%".to_owned(),
        };
        draw.text(Point::new(360, 8), &battery, self.theme.text);
    }
}

fn format_memory(bytes: Option<u32>) -> String {
    bytes
        .map(|value| format!("{} KiB", value / 1024))
        .unwrap_or_else(|| "--".into())
}

fn snapshot_date(snapshot: &ApplicationSnapshot) -> Option<GregorianDate> {
    let RtcStatus::Valid(time) = snapshot.status.rtc else {
        return None;
    };
    GregorianDate::new(i32::from(time.year), time.month, time.day)
}

const fn condition_label(condition: WeatherCondition) -> &'static str {
    match condition {
        WeatherCondition::Clear => "CLEAR",
        WeatherCondition::Cloudy => "CLOUDY",
        WeatherCondition::Fog => "FOG",
        WeatherCondition::Rain => "RAIN",
        WeatherCondition::Snow => "SNOW",
        WeatherCondition::Thunderstorm => "STORM",
        WeatherCondition::Unknown => "UNKNOWN",
    }
}

fn format_memory_pair(current: Option<u32>, minimum: Option<u32>) -> String {
    format!("{} / {}", format_memory(current), format_memory(minimum))
}

fn render_diagnostic_column(draw: &mut RawDraw<'_>, x: i32, rows: &[(&str, String)], theme: Theme) {
    for (index, (label, value)) in rows.iter().enumerate() {
        let y = 38 + index as i32 * 39;
        draw.text(Point::new(x, y), label, theme.muted);
        draw.wrapped_text(Bounds::new(x, y + 13, 187, 18), value, 1, theme.text);
    }
}

pub fn render(snapshot: &ApplicationSnapshot, framebuffer: &mut [u8]) {
    RawDrawUiManager::default().render(snapshot, framebuffer);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::Application;
    use crate::framebuffer::color_at;

    #[test]
    fn chinese_and_english_todo_characters_have_real_glyphs() {
        for character in "同步设计评审准备设备原型进行中上下选择确认切换设置名称无线网络局域地址未连接时区休眠分钟蓝牙配对等待安全图库为空请在上传四色图片全屏幻灯片每已用张上限错误MemoriloTODO".chars() {
            assert!(
                BitmapFont::supports(character),
                "missing glyph for {character}"
            );
        }
    }

    #[test]
    fn wrapping_and_pagination_are_deterministic() {
        let text = "同步ABCDEFGHIJK同步LMNOPQRST";
        let first = wrap_text(text, 45, 8);
        let second = wrap_text(text, 45, 8);
        assert_eq!(first, second);
        assert_eq!(
            first
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<String>(),
            text
        );
        assert!(first.lines.iter().all(|line| line.width <= 45));
        assert_eq!(page_ranges(first.lines.len(), 2).first(), Some(&(0..2)));
    }

    #[test]
    fn clipping_prevents_widgets_from_writing_outside_their_viewport() {
        let mut framebuffer = vec![0x55; FRAME_BYTES];
        let mut canvas = Canvas::new(&mut framebuffer);
        canvas.with_clip(Bounds::new(10, 10, 5, 5), |canvas| {
            canvas.fill_rect(Bounds::new(0, 0, 30, 30), Color::Red);
        });

        assert_eq!(color_at(&framebuffer, 9, 10), Color::White);
        assert_eq!(color_at(&framebuffer, 10, 10), Color::Red);
        assert_eq!(color_at(&framebuffer, 14, 14), Color::Red);
        assert_eq!(color_at(&framebuffer, 15, 14), Color::White);
    }

    #[test]
    fn list_viewport_keeps_selection_mapping_stable() {
        let viewport = ListViewport::around(20, 17, 6);
        assert!(viewport.visible.contains(&17));
        assert_eq!(viewport.visual_row(17), Some(3));
        assert_eq!(
            viewport.visible.start + viewport.visual_row(17).unwrap(),
            17
        );
        assert_eq!(viewport.visual_row(5), None);
    }

    #[test]
    fn todo_rows_are_not_actionable_and_semantic_widgets_use_four_color_tokens() {
        let mut application = Application::new([]);
        application.start();
        let mut framebuffer = vec![0; FRAME_BYTES];
        let metadata = RawDrawUiManager::default().render(application.snapshot(), &mut framebuffer);

        assert_eq!(metadata.visible_items, 0..6);
        assert_eq!(color_at(&framebuffer, 5, 38), Color::White);

        let mut widget_frame = vec![0x55; FRAME_BYTES];
        let mut draw = RawDraw::new(&mut widget_frame, Theme::default());
        draw.checkbox(Bounds::new(10, 10, 14, 14), true);
        draw.progress(Bounds::new(30, 10, 40, 10), 1, 2);
        assert_eq!(color_at(&widget_frame, 16, 16), Color::Black);
        assert_eq!(color_at(&widget_frame, 35, 14), Color::Red);
        assert_eq!(color_at(&widget_frame, 65, 14), Color::White);
    }

    #[test]
    fn diagnostics_page_renders_a_bounded_snapshot_without_periodic_state() {
        let mut application = Application::new([]);
        application.start();
        application.dispatch(crate::application::ApplicationCommand::DiagnosticsUpdated(
            crate::diagnostics::RuntimeDiagnostics {
                uptime_ms: 42_000,
                free_internal_bytes: Some(300 * 1024),
                minimum_free_internal_bytes: Some(280 * 1024),
                free_psram_bytes: Some(8 * 1024 * 1024),
                minimum_free_psram_bytes: Some(7 * 1024 * 1024),
                stack_high_water_bytes: Some(8 * 1024),
                buttons: [false, true, false],
                last_input: "ok-long",
                last_error: None,
            },
        ));
        application.dispatch(crate::application::ApplicationCommand::EnterDiagnostics);
        let mut framebuffer = vec![0x55; FRAME_BYTES];

        let metadata = RawDrawUiManager::default().render(application.snapshot(), &mut framebuffer);

        assert_eq!(metadata.visible_items, 0..12);
        assert!(framebuffer.iter().any(|byte| *byte != 0x55));
    }
}
