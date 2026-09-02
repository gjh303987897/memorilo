# ZECTRIX NOTE4C TODO firmware

Offline TODO UI prototype for the ZECTRIX NOTE4C: ESP32-S3 N16R8 with a
400 x 300 SSD2683 black/white/red/yellow e-paper panel.

The renderer uses the NOTE4C-native packed BWRY format:

- 2 bits per pixel, four pixels per byte, MSB first
- `00` black, `01` white, `10` yellow, `11` red
- 30,000 bytes per 400 x 300 frame

Fake TODO data covers open, doing, done, nested and undated items. GPIO39 and
GPIO18 move the selection; GPIO0 toggles complete/reopen.

## Display safety

The default configuration deliberately uses a fake display backend. It
compiles and logs BWRY pixel counts, but does not send commands to the panel.
Do not flash this default variant expecting it to update the panel.

The black-and-white NOTE4 `zectrix_epd` component is not compatible and is not
accepted by this project. The real backend is a minimal MIT-licensed adaptation
of the NOTE4C reference firmware linked by the official ZECTRIX Wiki:

```text
https://github.com/LazyYoun/youn-ink-fourcolor-firmware
CONFIG_ZECTRIX_EPD_PANEL_4COLOR_SSD2683=y
```

The adaptation is pinned to upstream commit
`51812e4ab3fa80ba7a5a5a274635ca2cf3901a25`; attribution and the extracted
scope are recorded under `components/zectrix_note4c_epd`. Upstream requires
ESP-IDF 5.4 or newer and its Windows build uses ESP-IDF 5.5.2, so no second IDF
installation is required.

## Build the safe fake backend

```text
idf.py set-target esp32s3
idf.py build
```

The real backend also participates in this build, but `NOTE4C_FAKE_DISPLAY`
remains enabled by default. It can be disabled in `idf.py menuconfig` only when
preparing a controlled hardware test. The real path uses the NOTE4C GPIO
assignment, 40 MHz SPI mode 0, active-low BUSY, and the upstream SSD2683
power/reset/refresh/deep-sleep sequence.

To compile the first physical-display test into a separate directory without
changing the safe default configuration:

```text
idf.py -B build-real -D IDF_TARGET=esp32s3 -D SDKCONFIG=build-real/sdkconfig -D "SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.real.defaults" build
```

This command only builds an image. It does not flash a connected device.
This variant displays black, white, red, and yellow vertical bars in that
left-to-right order, then leaves TODO input disabled.

After the color-bar test passes, build the interactive offline TODO variant in
its own directory:

```text
idf.py -B build-todo -D IDF_TARGET=esp32s3 -D SDKCONFIG=build-todo/sdkconfig -D "SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.todo.defaults" build
```

This variant uses the same real NOTE4C SSD2683 backend, renders the bundled
fake TODO data, and enables the GPIO39/GPIO18/GPIO0 controls. A button action
requests a full four-color refresh, so the updated selection may take roughly
25 seconds to appear. Button input remains active while the panel is busy.
Actions update the in-memory TODO state immediately, and actions received
during one refresh are coalesced into at most one follow-up refresh of the
latest state. GPIO3 is held high so the active-low status LED stays off.

## Back up a NOTE4C before any flash

Connect the NOTE4C in download mode and identify its new `COM` port. After
activating the ESP-IDF environment, create and verify a complete 16 MiB backup:

```powershell
. C:\Users\mslxl\esp\esp-idf-v5.5.2\export.ps1
.\tools\backup-note4c-flash.ps1 -Port COM5
```

The script accepts only a present `COM` port, writes under the ignored
`backups/` directory, refuses to overwrite an existing file, checks for exactly
16 MiB, and prints its SHA-256 hash. Replace `COM5` with the detected device
port. Reading the flash may reset the device, but does not write its flash.

Before any first flash, back up the complete 16 MB factory flash and verify the
device label says NOTE4C, not NOTE4.
