# ESP-IDF firmware flashing

This is the canonical real-device workflow for `apps/note4c-firmware` on
Windows. The Rust application is linked by Cargo and `esp-idf-sys`; ESP-IDF
still owns the bootloader, partition table, chip settings, and binary image
format.

Do not use the stale CMake output under `apps/note4c-firmware/build` for the
Rust application. `idf.py flash` only knows about that earlier CMake project
and cannot discover the final Rust ELF produced after `esp-idf-sys` links.
The project scripts therefore use the same underlying Espressif chain
explicitly:

1. Cargo builds the final Rust ELF with ESP-IDF 5.5.2.
2. ESP-IDF supplies `bootloader.bin` and `partition-table.bin`.
3. Espressif `esptool` converts the ELF and writes all three images in one
   verified session.

## Normal flash

Identify the target COM port, then run from the repository root:

```powershell
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COM3
```

The default variant is the interactive hardware-display firmware. Use the
explicit `hardware` variant when scripting; other explicit variants are:

```powershell
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COM3 -Variant hardware
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COM3 -Variant color-test
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COM3 -Variant fake
```

The default transfer rate is `460800`. For a marginal USB-Serial/JTAG link,
repeat the complete flash at a lower rate without changing the image or reset
sequence:

```powershell
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COM3 -Baud 115200
```

Use `-WhatIf` to build, generate, and validate the application image without
writing the device. Use `-SkipBuild` only when the selected target directory
already contains the intended current build.

The script deliberately:

- requires an explicit COM port;
- pins the Windows USB fixes in `esptool 5.4.0` through `uvx`;
- uses the ESP-IDF flash layout and stub-compressed transfer;
- exits ESP32-S3 force-download mode with esptool's `hard-reset` sequence;
- performs one serial session instead of probing the chip first;
- verifies every written image before resetting the target;
- rejects an application image that does not fit the selected app partition;
- keeps the serial monitor out of the flash transaction.

The flash layout is fixed by ESP-IDF:

| Address | Image |
| --- | --- |
| `0x0000` | ESP-IDF bootloader |
| `0x8000` | ESP-IDF partition table |
| `0x10000` | Rust application image (current factory partition; the script reads the actual partition table) |

## Monitor

Open the monitor only after flashing has completed and only when diagnostics
are needed:

```powershell
.\apps\note4c-firmware\tools\monitor-firmware.ps1 -Port COM3
```

The monitor uses Espressif `esp-idf-monitor 1.9.0`, opens the existing build
ELF for address decoding, and passes `--no-reset`. Flashing and monitoring in
one command is not supported because immediate COM-port reopen can wedge
Windows `usbser` on the ESP32-S3 native USB interface.

## Failure and recovery

- If connection fails before erase or write begins, reconnect USB and rerun
  the complete normal flash command once.
- If output shows erase or write progress before failing, assume the
  application partition is incomplete. Reconnect USB and rerun the complete
  normal flash command from the beginning.
- Treat Windows error 31, `Write timeout`, and `Serial data stream stopped` as
  a transport failure. Close serial tools before reconnecting the device.
- Do not turn partial-address or chunked writes into the normal workflow. They
  are a recovery technique and require an explicit recovery plan.
- Do not erase the whole flash or restore a backup without explicit user
  authorization. The factory-backup workflow remains
  `apps/note4c-firmware/tools/backup-note4c-flash.ps1`.

Completion means the flash command exits successfully after esptool verifies
the bootloader, partition table, and application. For display validation, wait
for the panel's approximately 20–25 second refresh before judging the result.
The retained panel keeps its old image across resets and power loss, so an
unchanged screen is not evidence that the new application booted.

## Build invariant

Keep `CONFIG_ESP_MAIN_TASK_STACK_SIZE=10000` in the effective ESP-IDF
configuration. The interactive application performs Rust UI and bitmap-font
rendering on the ESP main task before its first display request; the earlier
3584-byte override could fail before the first physical refresh even though
the minimal color-bar variant worked.
