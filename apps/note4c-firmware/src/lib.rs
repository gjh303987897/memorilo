pub mod application;
pub mod device_status;
pub mod diagnostics;
pub mod display_coordinator;
pub mod framebuffer;
pub mod gallery;
pub mod glance;
pub mod input;
pub mod model;
pub mod network;
pub mod persistence;
pub mod power;
pub mod provisioning;
pub mod provisioning_protocol;
pub mod ui;
pub mod weather;

#[cfg(target_os = "espidf")]
pub mod board;
#[cfg(target_os = "espidf")]
pub mod display;
#[cfg(target_os = "espidf")]
pub mod provisioning_ble;

#[cfg(all(feature = "fake-display", feature = "hardware-display"))]
compile_error!("enable exactly one display backend");

#[cfg(not(any(feature = "fake-display", feature = "hardware-display")))]
compile_error!("enable either fake-display or hardware-display");
