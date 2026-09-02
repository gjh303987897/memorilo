# Upstream

This component is a minimal C adaptation of the NOTE4C SSD2683 path from the
ZECTRIX Wiki-recommended reference firmware:

- Repository: https://github.com/LazyYoun/youn-ink-fourcolor-firmware
- Commit: `51812e4ab3fa80ba7a5a5a274635ca2cf3901a25`
- Source: `firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc`
- Board pins: `firmware/main/boards/zectrix-s3-epaper-4.2/config.h`

The adaptation retains the upstream GPIO assignment, 40 MHz SPI mode 0,
active-low BUSY handling, reset timing, command sequence, 2bpp wire format,
display refresh, power-off, and deep-sleep sequence. Application UI, LVGL,
audio, networking, partial-refresh scheduling, and black-and-white fallback
code are intentionally excluded.

The upstream repository and firmware subtree are MIT licensed. See `LICENSE`.
