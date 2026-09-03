#[cfg(target_os = "espidf")]
mod firmware {
    #[cfg(not(feature = "color-test"))]
    use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
    #[cfg(not(feature = "color-test"))]
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::thread;
    use std::time::Duration;

    #[cfg(not(feature = "color-test"))]
    use anyhow::bail;
    use anyhow::{Context, Result};
    use memorilo_device_firmware::board::Board;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::board::Button;
    use memorilo_device_firmware::display::Display;
    use memorilo_device_firmware::framebuffer::FRAME_BYTES;
    #[cfg(feature = "color-test")]
    use memorilo_device_firmware::framebuffer::render_color_test;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::model::TodoModel;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::ui;

    pub fn run() -> Result<()> {
        esp_idf_sys::link_patches();
        esp_idf_svc::log::EspLogger::initialize_default();

        #[cfg(feature = "color-test")]
        let _board = Board::new().context("board initialization failed")?;
        #[cfg(not(feature = "color-test"))]
        let mut board = Board::new().context("board initialization failed")?;
        let display = Display::new().context("display initialization failed")?;

        #[cfg(feature = "color-test")]
        {
            let mut display = display;
            let mut framebuffer = vec![0_u8; FRAME_BYTES];
            render_color_test(&mut framebuffer);
            display.refresh(&framebuffer)?;
            log::warn!("first-hardware-test color bars displayed; TODO input is disabled");
            loop {
                thread::sleep(Duration::from_secs(1));
            }
        }

        #[cfg(not(feature = "color-test"))]
        {
            let model = Arc::new(Mutex::new(TodoModel::default()));
            let (refresh_tx, refresh_rx) = sync_channel(1);
            spawn_display_task(Arc::clone(&model), refresh_rx, display)?;
            request_refresh(&refresh_tx)?;

            log::info!(
                "offline fake TODO UI ready ({} items); input remains active during refresh",
                lock_model(&model).items.len()
            );

            loop {
                if let Some(button) = board.poll_button() {
                    let selected = {
                        let mut model = lock_model(&model);
                        match button {
                            Button::Up => model.move_selection(-1),
                            Button::Down => model.move_selection(1),
                            Button::Ok => model.toggle_selected(),
                        }
                        model.selected
                    };
                    request_refresh(&refresh_tx)?;
                    log::info!("button accepted; selected={selected}, latest state queued");
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn lock_model(model: &Mutex<TodoModel>) -> MutexGuard<'_, TodoModel> {
        model
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(not(feature = "color-test"))]
    fn request_refresh(refresh_tx: &SyncSender<()>) -> Result<()> {
        match refresh_tx.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) => Ok(()),
            Err(TrySendError::Disconnected(())) => bail!("display task stopped"),
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn spawn_display_task(
        model: Arc<Mutex<TodoModel>>,
        refresh_rx: Receiver<()>,
        mut display: Display,
    ) -> Result<()> {
        thread::Builder::new()
            .name("display".into())
            .stack_size(64 * 1024)
            .spawn(move || {
                let mut framebuffer = vec![0_u8; FRAME_BYTES];
                while refresh_rx.recv().is_ok() {
                    ui::render(&lock_model(&model), &mut framebuffer);
                    match display.refresh(&framebuffer) {
                        Ok(()) => log::info!("displayed latest TODO state"),
                        Err(error) => log::error!("display refresh failed: {error:#}"),
                    }
                }
            })
            .context("display task creation failed")?;
        Ok(())
    }
}

#[cfg(target_os = "espidf")]
fn main() -> anyhow::Result<()> {
    firmware::run()
}

#[cfg(not(target_os = "espidf"))]
fn main() {
    println!("build this firmware for xtensa-esp32s3-espidf");
}
