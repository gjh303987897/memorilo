# Device TODO hardware acceptance

This runbook is for the final hardware-only acceptance item. It verifies the
two notification paths while keeping HTTPS authoritative and confirms that the
four-color display uses the verified full-frame sequence. A computed dirty
region is a scheduling hint only; it is not evidence of a physical partial
refresh.

## Prepare

1. Connect the device and identify its actual serial port. Do not use `COM1`
   unless Windows reports the board on that port.
2. Use the canonical ESP-IDF script from the repository root:

```powershell
.\apps\note4c-firmware\tools\flash-firmware.ps1 -Port COMx -Variant coordinator-test
.\apps\note4c-firmware\tools\monitor-firmware.ps1 -Port COMx
```

The `coordinator-test` image injects two navigation inputs during the first
physical refresh. Capture the commit, image hash, and the monitor output in the
acceptance record.

## Checks

- **Local application push:** change a TODO in Memorilo and wait for the
  debounced LAN push. `GET /v1/status` and `GET /v1/todos` must expose the new
  revision and a local source; the device must update after its current refresh
  completes.
- **Server notification:** change the canonical server projection and publish
  the device-scoped MQTT notification. The monitor must show a notification
  event followed by an HTTPS snapshot request. The MQTT payload must not contain
  task text or task actions.
- **Offline cache:** disconnect Wi-Fi, reboot, and confirm that the last valid
  TODO snapshot remains visible. Reconnect and confirm that periodic HTTPS
  polling recovers the newer revision.
- **Input during refresh:** in the coordinator test, confirm both injected
  inputs are accepted while the first refresh is busy and that only the latest
  successor frame is displayed afterward.
- **Four-color refresh policy:** make a small visual change and inspect the
  display diagnostics. The physical path must still send the complete 30,000
  byte `0x10` frame and use the full-frame `0x12` activation sequence. Do not
  substitute a black/white LUT or a guessed partial-window command.
- **Front light:** during background synchronization, HTTP/MQTT handling, and
  display refresh, confirm the front-light GPIO remains in its off state. The
  firmware keeps GPIO3 high and does not acquire a light lease for sync.

## Evidence

Record the serial port, firmware revision, variant, application SHA-256, test
timestamps, status JSON revisions, and monitor lines for `DIAG refresh_start`,
`DIAG refresh_end`, `DIAG boot_complete`, and the coordinator-test input
messages. Keep one photo of the resulting page and one offline-cache result.
