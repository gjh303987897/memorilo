---
name: esp-idf-flashing
description: Build, flash, recover, or monitor the repository's ESP32-S3 firmware using its validated ESP-IDF artifact and official Espressif tooling workflow. Use for real-device firmware operations, not host-only tests.
---

# ESP-IDF flashing

Before a real-device operation, read
[`docs/agents/esp-idf-flashing.md`](../../../docs/agents/esp-idf-flashing.md).

Use the project PowerShell entry points from that document. Require an
explicit COM port and preserve the separation between flash and monitor.

Treat a transport failure after erase or write begins as a potentially
incomplete application. Report the state, reconnect the target, and rerun the
complete canonical flash command. Partial writes, whole
flash erasure, and backup restoration are recovery operations that require an
explicit plan and matching user authorization.

The operation is complete only after Espressif tooling verifies every image
and resets the target. Wait for the physical display refresh when visual
validation is part of the request.
