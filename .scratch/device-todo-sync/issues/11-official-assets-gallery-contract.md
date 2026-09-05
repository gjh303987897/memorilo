# 11: Move the gallery to the official assets storage contract

**What to build:** Gallery images use the NOTE4C official assets partition and remain available through the existing local management workflow without affecting TODO/Wi-Fi/BLE configuration.

**Blocked by:** fourcolor-firmware-integration #06, #08, #13

**Status:** completed

- [x] Use the official bounded assets filesystem and versioned image index for 400x300 four-color assets.
- [x] Permit upgrades to clear the old custom gallery area while preserving TODO, Wi-Fi, BLE, and device configuration.
- [x] Keep image upload, browse, delete, reorder, and optional slideshow operations on authenticated HTTP.
- [x] Verify gallery activity does not permanently block sleep or TODO synchronization.
