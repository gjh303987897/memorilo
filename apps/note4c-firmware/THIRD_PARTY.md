# Firmware third-party notices

## u8g2-fonts

The Rust font decoder is provided by `u8g2-fonts`, licensed under MIT OR
Apache-2.0. Its embedded fonts originate from U8g2 and retain their respective
font licenses. The firmware selects `u8g2_font_wqy12_t_gb2312`, derived from the
WenQuanYi bitmap font collection. See:

- <https://github.com/Finomnis/u8g2-fonts>
- <https://github.com/olikraus/u8g2/blob/master/LICENSE>
- <https://github.com/olikraus/u8g2/wiki/fntgrpwqy>

The selected font is compiled into flash as a static lookup table. The firmware
does not allocate a full font cache in RAM.
