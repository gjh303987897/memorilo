# 10: Configure TODO synchronization through BLE settings

**What to build:** The Memorilo Device settings page provisions NOTE4C's server and notification settings over the existing authenticated BLE flow.

**Blocked by:** 02; fourcolor-firmware-integration #09, #10, #11

**Status:** completed

- [x] Configure HTTPS base URL, device read token, MQTT notification settings, enable flag, interval, and `today/all` view.
- [x] Validate URL, token, interval, and topic bounds before an atomic NVS commit.
- [x] Keep BLE for pairing/configuration only; never transfer TODO contents over BLE.
- [x] Redact secrets from read responses, logs, analytics, and ordinary renderer state.
