# 09: Connect Memorilo to device notifications and LAN readback

**What to build:** Memorilo initiates an authenticated LAN HTTP push after local TODO data changes and can read the device export to verify the displayed revision. The device never connects back to Memorilo.

**Blocked by:** 01, 02, 08; fourcolor-firmware-integration #13

**Status:** completed

- [x] Use configured device targets and push a bounded snapshot with a stable revision and deduplication metadata.
- [x] Read the authenticated LAN export by initiating the request from the client.
- [x] Do not require a listening port, inbound firewall rule, or device-initiated callback on the desktop.
- [x] Track per-device delivery state without exposing tokens or sending task actions.
- [x] Handle LAN failures without blocking ordinary TODO editing and expose delivery/stale-revision state in the settings UI.
- [x] Persist LAN device targets and expose delivery/stale-revision state in the desktop settings UI.
