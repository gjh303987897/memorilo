# ZECTRIX NOTE4C SSD2683 驱动集成调查

调查日期：2026-09-01

## 结论

可以把 ZECTRIX Wiki 推荐参考固件中的 NOTE4C 显示路径 vendoring 到
`apps/note4c-firmware`，但不应原样复制整个 `CustomLcdDisplay` 类。该类把
SSD2683、LVGL、RawDraw、异步刷新、睡眠管理和应用基类耦合在一起；真正的
硬件最小集只有 GPIO/SPI 初始化、BUSY 等待、复位、2bpp 整帧发送、刷新、
掉电和深睡序列。

推荐形态是独立 ESP-IDF C 组件 `zectrix_note4c_epd`，上层继续使用
`note4c_display_init/refresh/deinit`。当前工作树已采用这一边界，并保留假显示
开关；在实机验收前仍不应刷写。

## 调查基线

- ZECTRIX 规格页：<https://wiki.zectrix.com/zh/hardware/note/spec>
- ZECTRIX 开发指南：<https://wiki.zectrix.com/zh/software/note4-development-guide>
- Wiki 推荐参考仓库：
  [`LazyYoun/youn-ink-fourcolor-firmware`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware)
- 本次审计固定 revision：
  [`51812e4ab3fa80ba7a5a5a274635ca2cf3901a25`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/commit/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25)
- 本机可复现 ESP-IDF：官方 tag `v5.5.2`，commit
  [`30aaf64524299d3bde422ca9a2848090d1bc5d0f`](https://github.com/espressif/esp-idf/commit/30aaf64524299d3bde422ca9a2848090d1bc5d0f)

Wiki 页面是可变网页，没有 revision 标识。下文中的 NOTE4C 规格、共板/不可
混刷和推荐仓库信息来自此前对上述两页的逐项核对记录；驱动实现结论全部重新
核对到固定 commit，因而可复现。

## ESP-IDF 版本判断

参考仓库没有固定唯一的 ESP-IDF commit，不能把“上游准确版本”写成一个并不
存在的 SHA：

- README 的 Linux 编译示例加载 `~/Documents/esp/v6.0/esp-idf/export.sh`：
  [README.md#L122-L130](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/README.md#L122-L130)。
- Windows 构建脚本硬编码 `esp-idf-v5.5.2` 并设置
  `ESP_IDF_VERSION=5.5.2`：
  [build_windows.ps1#L97-L102](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/build_windows.ps1#L97-L102)、
  [#L146-L159](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/build_windows.ps1#L146-L159)。
- Component Manager manifest 只约束 `idf >=5.4.0`：
  [idf_component.yml#L100-L106](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/idf_component.yml#L100-L106)。

因此当前项目应固定使用已经安装且与上游 Windows 路径一致的 **ESP-IDF
v5.5.2 / `30aaf645...`** 完成第一轮编译和实机 bring-up。没有必要仅因 README
示例安装 6.0；若以后切换 6.0，应作为单独的工具链升级验证。ESP-IDF 官方组件
结构和 `idf_component_register` 约定见
[Build System](https://docs.espressif.com/projects/esp-idf/en/v5.5.2/esp32s3/api-guides/build-system.html)，
SPI API 见
[SPI Master Driver](https://docs.espressif.com/projects/esp-idf/en/v5.5.2/esp32s3/api-reference/peripherals/spi_master.html)。

## NOTE4C 硬件契约

此前从 ZECTRIX Wiki 核对的 NOTE4C 契约如下：

| 项目 | NOTE4C |
| --- | --- |
| MCU | ESP32-S3 N16R8，16 MiB Flash、8 MiB PSRAM |
| 面板 | 400 x 300，SSD2683，黑/白/红/黄四色 |
| framebuffer | 2bpp，`400 * 300 / 4 = 30,000` bytes |
| 像素码 | `00=黑`、`01=白`、`10=黄`、`11=红` |
| NOTE4 关系 | 共用控制板和 GPIO；显示面板与固件不同，不可混刷 |

固定源码与该记录一致：颜色 enum 明确为 0/1/2/3：
[rawdraw.h#L49-L60](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/rawdraw/rawdraw.h#L49-L60)。
每字节按 MSB-first 容纳四个像素，像素 `x` 使用位移
`6 - ((x & 3) << 1)`；全白/黄/红填充值分别是 `0x55/0xAA/0xFF`：
[rawdraw.cc#L65-L101](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/rawdraw/rawdraw.cc#L65-L101)。
板级代码按同一公式得到 30,000 字节：
[zectrix-s3-epaper-4.2.cc#L318-L346](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/zectrix-s3-epaper-4.2.cc#L318-L346)。

### GPIO

固定源码中的 NOTE4C 显示和电源引脚：

| 信号 | GPIO |
| --- | ---: |
| EPD DC | 10 |
| EPD CS | 11 |
| EPD SCK | 12 |
| EPD MOSI | 13 |
| EPD RESET | 9 |
| EPD BUSY | 8 |
| EPD rail power | 6 |
| VBAT latch | 17 |
| 上 / 确认 / 下 | 39 / 0 / 18 |

来源：
[config.h#L20-L27](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/config.h#L20-L27)、
[#L44-L62](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/config.h#L44-L62)。

参考驱动使用 `SPI3_HOST`、mode 0、40 MHz，CS 由 GPIO 手动控制；BUSY 为
低电平忙、高电平就绪，四色超时为 120 秒：
[custom_lcd_display.cc#L671-L725](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L671-L725)、
[#L764-L783](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L764-L783)。

## 上电与刷新时序

参考实现的完整四色整帧时序是：

1. 板级启动先将 VBAT latch GPIO17、EPD rail GPIO6 拉高：
   [zectrix-s3-epaper-4.2.cc#L265-L277](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/zectrix-s3-epaper-4.2.cc#L265-L277)。
2. 每次刷新唤醒面板：GPIO6 高，延时 10 ms；RESET 高 10 ms、低 20 ms、
   高 10 ms；等待 BUSY 释放；发送 `0xE9, 0x01`：
   [custom_lcd_display.cc#L888-L929](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L888-L929)。
3. 发送 DTM1 `0x10`，等待 BUSY，然后逐行发送 100 bytes，共 300 行、
   30,000 bytes：
   [custom_lcd_display.cc#L993-L1015](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L993-L1015)。
4. `0x04` 上电并等 BUSY；延时 10 ms；`0x12, 0x00` 刷新；延时 10 ms
   并等 BUSY；`0x02, 0x00` 关电并等 BUSY；延时 20 ms；
   `0x07, 0xA5` 深睡；最后 GPIO6 拉低：
   [custom_lcd_display.cc#L862-L899](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L862-L899)。

参考固件对四色面板总是执行 full refresh，不走其黑白 partial-refresh 分支：
[custom_lcd_display.cc#L613-L650](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L613-L650)。
第一版移植应保持这个限制，不自行发明四色局刷波形。

## 上游目录、开关和公共 API

上游 **没有** 可直接依赖的独立 `zectrix_epd` ESP-IDF 组件。驱动位于：

- `firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.{h,cc}`：
  SPI/GPIO、控制器时序、framebuffer 和应用显示类。
- `firmware/main/boards/zectrix-s3-epaper-4.2/config.h`：板级 pin map。
- `firmware/main/boards/zectrix-s3-epaper-4.2/zectrix-s3-epaper-4.2.cc`：
  组装配置、30,000-byte buffer 和板级电源顺序。
- `firmware/main/rawdraw/rawdraw.{h,cc}`：2bpp 颜色和像素打包；这属于 UI，
  不是硬件驱动必需依赖。

上游对外暴露的是耦合的 C++ `CustomLcdDisplay`。最直接的四色入口是
`DisplayRaw4ColorImage(data, len, width, height)`，它严格检查 400 x 300 和
30,000-byte 长度，然后走整帧刷新：
[custom_lcd_display.h#L42-L68](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.h#L42-L68)、
[#L126-L135](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.h#L126-L135)、
[custom_lcd_display.cc#L1078-L1115](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L1078-L1115)。

Kconfig 必须选择：

```text
CONFIG_ZECTRIX_EPD_PANEL_4COLOR_SSD2683=y
# CONFIG_ZECTRIX_EPD_4COLOR_BOOT_TEST_PATTERN is not set
```

来源：
[sdkconfig.defaults.esp32s3#L30-L31](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/sdkconfig.defaults.esp32s3#L30-L31)、
[Kconfig.projbuild#L19-L42](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/Kconfig.projbuild#L19-L42)。
当前小型 TODO 工程不需要复制上游这一组面板选择开关；它只支持 NOTE4C，
保留自己的 `CONFIG_NOTE4C_FAKE_DISPLAY` 作为防误刷门闩即可。

## 最小 vendoring 清单

不建议直接复制上游文件，因为 `custom_lcd_display.cc` 依赖显示基类、LVGL、
RawDraw、Settings 和 SleepManager。应从固定 commit 抽取并保留出处：

| 目标文件 | 内容 |
| --- | --- |
| `components/zectrix_note4c_epd/CMakeLists.txt` | 注册独立 ESP-IDF 组件，仅依赖 `driver`、`freertos`、`log` |
| `components/zectrix_note4c_epd/include/zectrix_note4c_epd.h` | 400 x 300、30,000 bytes、pin/config、opaque handle 和三函数 API |
| `components/zectrix_note4c_epd/zectrix_note4c_epd.c` | 从上游抽取 GPIO/SPI、BUSY、reset、DTM1、full refresh、power-off/deep-sleep |
| `components/zectrix_note4c_epd/LICENSE` | 同时保留仓库根和 `firmware/` 的 MIT copyright/permission notice |
| `components/zectrix_note4c_epd/UPSTREAM.md` | 仓库 URL、固定 commit、源文件、保留/排除项 |

建议的窄 API：

```c
esp_err_t zectrix_note4c_epd_new(
    const zectrix_note4c_epd_config_t *config,
    zectrix_note4c_epd_t **out_epd);
esp_err_t zectrix_note4c_epd_refresh(
    zectrix_note4c_epd_t *epd,
    const uint8_t framebuffer[30000],
    size_t size);
void zectrix_note4c_epd_delete(zectrix_note4c_epd_t *epd);
```

这正好适配现有 `apps/note4c-firmware/main/note4c_display.*`，不会把上游应用
框架带进 Memorilo。当前工作树的
`apps/note4c-firmware/components/zectrix_note4c_epd/` 已实现这一结构，主任务已用
ESP-IDF v5.5.2 分别完成假后端和真实后端构建。构建通过只证明 API/工具链集成，
仍需实机测试确认，不能据此宣称硬件可用。

## 许可证判断

可以 vendoring。固定 revision 的仓库根目录是 MIT，copyright 为
`Copyright (c) 2026 macheng2017`：
[LICENSE](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/LICENSE)。
`firmware/` 子树另有 MIT 文件，copyright 为
`Copyright (c) 2025 Shenzhen Xinzhi Future Technology Co., Ltd.` 和
`Copyright (c) 2025 Project Contributors`：
[firmware/LICENSE](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/LICENSE)。

MIT 要求在软件副本或实质部分中包含 copyright 和 permission notice。由于
根许可证与 firmware 子树各有一份署名，最保守做法是把两组署名合并保留，
并在源文件 SPDX 注释和 `UPSTREAM.md` 中写明固定来源。仓库中的原始 MSP430
样例 `4D2_BWRY_400x300_2683_test(2)(1).c` 没有自己的文件头，不应复制进组件；
最多把它当命令时序的交叉参考。

## 集成和验收边界

1. 继续默认 `CONFIG_NOTE4C_FAKE_DISPLAY=y`；编译成功不等于允许刷机。
2. 编译固定使用 ESP-IDF v5.5.2 / `30aaf645...`，记录生成物 SHA 和 size。
3. 刷机前确认机身是 NOTE4C，并完整备份 16 MiB Flash；NOTE4 镜像绝不复用。
4. 首次实机只显示固定四色条：逐项确认黑、白、黄、红以及方向；颜色码、
   MSB-first 顺序任一错误都停止后续测试。
5. 测量 GPIO6/17、RESET 和 BUSY 时序；验证 BUSY 超时返回错误且最终切断
   GPIO6，而不是继续假定刷新成功。
6. 首版仅全刷；验证多次 TODO 页面切换、休眠/唤醒、USB 供电和电池供电后，
   才移除“不可刷写”警告。

## 未由源码证明的事项

- 参考仓库未固定 ESP-IDF SHA；上文选择 v5.5.2 是当前项目的可复现基线，
  不是声称上游只支持 5.5.2。
- 源码审计不能证明 40 MHz SPI 在每台 NOTE4C 上都有裕量，也不能替代示波器、
  逻辑分析仪或真实面板测试。
- 固定源码明确对四色面板只做 full refresh；没有证据支持自行添加四色局刷。
- Wiki 是可变页面；若未来规格或推荐仓库变化，应保存页面快照并重新固定上游
  commit 后再升级 vendored 组件。
