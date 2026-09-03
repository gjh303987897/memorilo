pub mod framebuffer;
pub mod model;
pub mod ui;

#[cfg(target_os = "espidf")]
pub mod board;
#[cfg(target_os = "espidf")]
pub mod display;

#[cfg(all(feature = "fake-display", feature = "real-display"))]
compile_error!("enable exactly one display backend");

#[cfg(not(any(feature = "fake-display", feature = "real-display")))]
compile_error!("enable either fake-display or real-display");
