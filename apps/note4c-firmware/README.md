# Device TODO firmware

Rust application firmware for the ESP32-S3 N16R8 board and its 400 x 300
SSD2683 black/white/red/yellow e-paper panel. The application, TODO model,
framebuffer renderer, button handling, and refresh scheduler are Rust. The
verified panel command sequence remains in the C ESP-IDF component under
`components/zectrix_note4c_epd` and is called through a three-function FFI
bridge.

The renderer uses the panel-native packed BWRY format: two bits per pixel,
four pixels per byte, MSB first. `00` is black, `01` white, `10` yellow, and
`11` red. One 400 x 300 frame uses 30,000 bytes.

TODO content is a read-only projection synchronized from Memorilo: none of the
three device buttons completes, reopens, reorders, or otherwise mutates a TODO.
GPIO3 is held high so the active-low status LED remains off.

Long-press GPIO39/Up for the previous page or GPIO18/Down for the next page.
The normal page loop is Todo, Gallery, Calendar, and Weather; it has no on-device
Settings page. Short presses
remain contextual: Gallery and Calendar use Up/Down for their local view, and
GPIO0/Confirm opens or closes a gallery image or returns Calendar to the current
month. Holding Up+Down opens the dedicated BLE pairing status page; all device
configuration is edited in Memorilo. Gallery metadata and
exact 30,000-byte frames live in the upstream-compatible 8 MiB `assets`
SPIFFS partition with dual generation index slots. Confirm opens or closes the
selected full-screen image; Up and Down continue to work while a physical
refresh is running. Existing data in the former custom `gallery` region is not
migrated.
Optional slideshow intervals start at five minutes and never acquire a
permanent sleep lease. Memorilo performs contain/cover resize, four-color
dithering, authenticated upload, delete, and reorder operations from its Device
settings page. The local HTTP contract is documented in
[`docs/device-provisioning-protocol.md`](../../docs/device-provisioning-protocol.md).

## Toolchain

Install Rust and `uv` through Scoop, then install the Rust ESP tools unavailable
in Scoop:

```powershell
scoop install uv
cargo install espup ldproxy
espup install --std --targets esp32s3
. $env:USERPROFILE\export-esp.ps1
```

The crate pins ESP-IDF 5.5.2 and lets `esp-idf-sys` manage its build tools.
The flash and monitor scripts obtain pinned official Espressif Python tools
through `uvx`.

## Test and build

Run the TODO model and framebuffer tests on the host:

```powershell
cargo +stable test --target x86_64-pc-windows-msvc
```

The default build uses a fake display and sends no panel commands:

```powershell
cargo build --target-dir C:\tmp\mf --release
```

Build the physical-display color bars, then the interactive TODO firmware:

```powershell
cargo build --target-dir C:\tmp\mf --release --no-default-features --features "hardware-display,color-test"
cargo build --target-dir C:\tmp\mf --release --no-default-features --features hardware-display
```

The `coordinator-test` variant injects two synthetic navigation commands during
the first physical refresh. It is only for repeatable real-device verification
that input remains accepted and that one latest successor frame is displayed:

```powershell
.\tools\flash-firmware.ps1 -Port COM3 -Variant coordinator-test
```

The short target directory avoids the ESP-IDF Windows path-length limit in deep
worktrees. Real-device flashing uses the official Espressif image and serial
tools through the project script; `cargo run` is intentionally not a flashing
entry point:

```powershell
.\tools\flash-firmware.ps1 -Port COM3
.\tools\monitor-firmware.ps1 -Port COM3
```

If the native USB-Serial/JTAG link drops during transfer, retry the complete
flash at a lower rate with `-Baud 115200`; the default remains `460800`.

Run the monitor separately and only when diagnostics are needed. The canonical
workflow and recovery rules are documented in
[`docs/agents/esp-idf-flashing.md`](../../docs/agents/esp-idf-flashing.md).
Button input remains active during the roughly 20 to 25 second panel refresh.
A capacity-one channel coalesces input received during a refresh into at most
one follow-up refresh of the latest Rust model state.

After building or flashing, report the exact revision, Cargo features, image
size, and image hash with:

```powershell
.\tools\measure-firmware.ps1 -Variant hardware
```

The preparation path runs ESP-IDF's official partition generator over the
checked-in CSV. It keeps NVS and the factory application at their existing
offsets, reserves a 3 MiB factory slot, and places the upstream-compatible
8 MiB `assets` SPIFFS partition at `0x800000`. Measurement and budget checks reject
stale images and images that exceed the actual app partition. This factory-only
layout is intentionally not treated as the secure OTA design.

The serial monitor emits machine-searchable `DIAG` records at boot and around
every physical refresh. Snapshot records include free and minimum heap,
internal RAM, PSRAM, and the current task's stack high-water mark. Refresh
records include elapsed time and the first completed frame's boot-relative
timestamp. Current draw still requires an external USB power meter or ammeter.

The hidden diagnostics page remains available through the internal diagnostic
command but is not part of the normal device page loop. Confirm returns to the
Todo page. The page never refreshes periodically. Release
budgets and the explicit runtime/power review gate are documented in
[`docs/firmware-acceptance-budgets.md`](../../docs/firmware-acceptance-budgets.md).

## Display driver boundary

The C component owns SPI, panel power, reset, BUSY polling, refresh, and deep
sleep. Rust owns its handle and only calls initialize, refresh, and delete
through `note4c_epd_bridge.h`. The driver attribution and pinned upstream commit
are recorded in `components/zectrix_note4c_epd/UPSTREAM.md`.

## Back up flash before the first write

Connect the device in download mode, activate the existing ESP-IDF environment,
and create a verified 16 MiB backup before the first flash:

```powershell
. C:\Users\mslxl\esp\esp-idf-v5.5.2\export.ps1
.\tools\backup-note4c-flash.ps1 -Port COM5
```

The script writes under the ignored `backups/` directory, refuses to overwrite
an existing file, checks its size, and prints its SHA-256 hash.
