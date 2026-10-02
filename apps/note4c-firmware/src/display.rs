#[cfg(feature = "hardware-display")]
use std::ffi::c_void;
#[cfg(feature = "hardware-display")]
use std::ptr::NonNull;

use anyhow::{Result, ensure};
#[cfg(feature = "hardware-display")]
use esp_idf_sys::esp;

use crate::framebuffer::FRAME_BYTES;

#[cfg(feature = "hardware-display")]
unsafe extern "C" {
    fn note4c_epd_bridge_new(out_display: *mut *mut c_void) -> i32;
    fn note4c_epd_bridge_refresh(display: *mut c_void, framebuffer: *const u8, size: usize) -> i32;
    fn note4c_epd_bridge_delete(display: *mut c_void);
}
enum Backend {
    #[cfg(feature = "fake-display")]
    Fake(Vec<u8>),
    #[cfg(feature = "hardware-display")]
    Hardware(NonNull<c_void>),
}
pub struct Display {
    backend: Backend,
}

// The driver handle is owned by one display thread and is never accessed concurrently.
#[cfg(feature = "hardware-display")]
unsafe impl Send for Display {}

impl Display {
    pub fn new() -> Result<Self> {
        #[cfg(feature = "fake-display")]
        {
            log::warn!("fake BWRY backend; no panel commands will be sent");
            return Ok(Self {
                backend: Backend::Fake(vec![0x55; FRAME_BYTES]),
            });
        }

        #[cfg(feature = "hardware-display")]
        {
            let mut handle = std::ptr::null_mut();
            esp!(unsafe { note4c_epd_bridge_new(&mut handle) })?;
            let handle =
                NonNull::new(handle).expect("C driver returned success with a null handle");
            log::warn!("hardware SSD2683 backend enabled");
            Ok(Self {
                backend: Backend::Hardware(handle),
            })
        }
    }

    pub fn refresh(&mut self, framebuffer: &[u8]) -> Result<()> {
        ensure!(framebuffer.len() == FRAME_BYTES, "invalid framebuffer size");

        match &mut self.backend {
            #[cfg(feature = "fake-display")]
            Backend::Fake(shadow) => {
                shadow.copy_from_slice(framebuffer);
                let mut counts = [0_u32; 4];
                for byte in framebuffer {
                    counts[((byte >> 6) & 3) as usize] += 1;
                    counts[((byte >> 4) & 3) as usize] += 1;
                    counts[((byte >> 2) & 3) as usize] += 1;
                    counts[(byte & 3) as usize] += 1;
                }
                log::info!(
                    "fake BWRY refresh: black={} white={} yellow={} red={}",
                    counts[0],
                    counts[1],
                    counts[2],
                    counts[3]
                );
                Ok(())
            }
            #[cfg(feature = "hardware-display")]
            Backend::Hardware(handle) => {
                esp!(unsafe {
                    note4c_epd_bridge_refresh(
                        handle.as_ptr(),
                        framebuffer.as_ptr(),
                        framebuffer.len(),
                    )
                })?;
                Ok(())
            }
        }
    }
}

impl Drop for Display {
    fn drop(&mut self) {
        #[cfg(feature = "hardware-display")]
        match &self.backend {
            Backend::Hardware(handle) => unsafe { note4c_epd_bridge_delete(handle.as_ptr()) },
        };
    }
}
