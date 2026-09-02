# PocketJS 与 ZECTRIX NOTE4 兼容性调查

调查日期：2026-08-31

## 结论

**不能把当前 PocketJS 主线版本直接刷入或直接运行在 ZECTRIX NOTE4 上。**

**经过板级移植后，运行 PocketJS 的通用 ESP32-S3 组件在技术上可行，但截至调查日期仍不是 PocketJS 的正式支持目标，也没有 NOTE4 实机验收证据。** 最合理的判断是：

- 当前已合并主线：不兼容。主线的 ESP-IDF 图形适配是 ESP32-P4 专用 PPA 后端；目标检查和文档都把它限定为 `esp32p4`。
- PocketJS 未合并 PR #335：为 ESP32-P4 和 ESP32-S3 增加了可组合的 QuickJS、UI core、UI QuickJS binding、软件 RGB565 renderer 和 runner。它为 NOTE4 提供了可复用的运行时基础，但 PR 仍是开放状态，且其验证明确没有刷写真实硬件。
- NOTE4：是 ESP32-S3 N16R8（16 MB Flash、8 MB PSRAM），400 x 300、SSD2683 黑白电子墨水屏；显示、电源、按键和外围设备都需要 NOTE4 专属 host/BSP。

因此应把项目定义为 **“PocketJS ESP32-S3/NOTE4 host 移植”**，而不是“下载 PocketJS 固件”。在完成软件渲染输出到 NOTE4 EPD、输入/电源适配和真实设备验收前，不应宣称可用或指导用户刷写。

## 对象身份与版本

### PocketJS

本报告所指 PocketJS 是 `pocket-stack/pocketjs`：一个以 QuickJS guest 驱动 Rust UI core 的无 DOM、无 WebView 运行时，应用通过编译后的 component bundle 运行。

- 主线调查 revision：[`0a90bf9`](https://github.com/pocket-stack/pocketjs/commit/0a90bf904d835210e52a11ed275a86d0040b5086)（2026-08-30）。
- 主线 README 的硬件表把 ESP-IDF 条目与 PPA 后端放在一起，并说明该适配只支持 ESP32-P4：[`hosts/esp32p4/README.md`](https://github.com/pocket-stack/pocketjs/blob/0a90bf904d835210e52a11ed275a86d0040b5086/hosts/esp32p4/README.md)。
- ESP32-P4 PPA 后端 PR #160 已合并，但其兼容性声明仍是 ESP-IDF 6.0/6.1、目标仅 `esp32p4`：[`PR #160`](https://github.com/pocket-stack/pocketjs/pull/160)。
- ESP-IDF 组件化 PR #335 的 revision 为 [`cfcd03b`](https://github.com/pocket-stack/pocketjs/commit/cfcd03b8c7af9a18b46a02456a8b293978c9dfc3)，截至调查日仍为开放 PR：[`PR #335`](https://github.com/pocket-stack/pocketjs/pull/335)。

“PocketJS”也有其他同名 JavaScript 项目；本次采用上述官方 PocketJS 仓库，因为它是唯一与嵌入式硬件运行时、ESP-IDF 和 NOTE4 场景相符的项目。

### ZECTRIX NOTE4

本报告所指 NOTE4 是黑白屏的 ZECTRIX NOTE4 Developer Kit，不是四色 NOTE4C。官方开发指南明确警告两者使用不同显示硬件和固件镜像，不可混刷。

- 官方规格：[`ZECTRIX NOTE4 规格`](https://wiki.zectrix.com/zh/hardware/note/spec)。
- 官方开发指南：[`NOTE4 开发套件开发指南`](https://wiki.zectrix.com/zh/software/note4-development-guide)。
- 可复现的公开参考工程：[`itopinion/zectrix-note4-epd-demo`](https://github.com/itopinion/zectrix-note4-epd-demo)，revision [`ca285c9`](https://github.com/itopinion/zectrix-note4-epd-demo/commit/ca285c98ed0641f86780edb1f5ec77b0335fe649)。该工程自称是硬件 demo/驱动参考，不是消费版完整固件或云服务。

## 事实对照

| 项目 | PocketJS 已合并主线 | PocketJS PR #335（未合并） | ZECTRIX NOTE4 |
| --- | --- | --- | --- |
| MCU / ISA | ESP32-P4 路径使用 P4 原生工具链；主线没有 NOTE4/S3 host | 同时声明支持 ESP32-P4、ESP32-S3；S3 native archive 使用 `xtensa-esp32s3-none-elf` | ESP32-S3 N16R8（Xtensa） |
| Flash / RAM | P4 示例配置由产品 host 决定 | 示例开启 PSRAM；组件本身不替产品决定缓冲区和分区 | 16 MB Flash、8 MB PSRAM |
| renderer | 主线 P4 PPA：FILL/BLEND/SRM，目标仅 P4 | 通用软件 RGB565 renderer 支持 P4/S3；P4 可选加 PPA | SSD2683 黑白 EPD，应用接口是 1bpp/4bpp 帧和同步 BUSY 握手 |
| 画面 | P4 文档示例是 RGB565、普通 framebuffer | 组件仍输出 RGB565；产品 host 负责 display buffer 和 presentation | 400 x 300；1bpp 全刷/局刷，4bpp/16 灰阶全刷 |
| 输入 | host 负责采样并转换成 PocketJS input | runner 只消费硬件无关 input，不提供板级驱动 | GPIO0/39/18 三键，另有电源锁存和 USB BOOT/RESET |
| 运行节拍 | PocketJS UI core 按 frame/tick 运行 | runner 提供精确 cadence，但不负责显示提交 | EPD 刷新受面板 BUSY 和 ghosting 策略约束，不能按普通 LCD 的 60 fps 连续呈现 |

来源：PocketJS [`docs/ESP_IDF.md`](https://github.com/pocket-stack/pocketjs/blob/cfcd03b8c7af9a18b46a02456a8b293978c9dfc3/docs/ESP_IDF.md)、[`hosts/esp-idf/README.md`](https://github.com/pocket-stack/pocketjs/blob/cfcd03b8c7af9a18b46a02456a8b293978c9dfc3/hosts/esp-idf/README.md)、[`pocketjs_render_rgb565` README](https://github.com/pocket-stack/pocketjs/blob/cfcd03b8c7af9a18b46a02456a8b293978c9dfc3/hosts/esp-idf/components/pocketjs_render_rgb565/README.md)；NOTE4 [`README.md`](https://github.com/itopinion/zectrix-note4-epd-demo/blob/ca285c98ed0641f86780edb1f5ec77b0335fe649/README.md)、[`docs/EPD_API.md`](https://github.com/itopinion/zectrix-note4-epd-demo/blob/ca285c98ed0641f86780edb1f5ec77b0335fe649/docs/EPD_API.md)、[`docs/HARDWARE.md`](https://github.com/itopinion/zectrix-note4-epd-demo/blob/ca285c98ed0641f86780edb1f5ec77b0335fe649/docs/HARDWARE.md)。

## 为什么不能直接运行

1. **目标/ABI 不同。** 当前主线的可复用 PPA adapter 在 CMake 和文档中要求 `esp32p4`。把 P4 archive、PPA 组件或 P4 固件放到 ESP32-S3 上不是可接受的降级路径。
2. **显示模型不同。** PocketJS 的通用 IDF renderer 产生 RGB565 draw strips；NOTE4 参考驱动接受严格尺寸的 15,000-byte 1bpp 或 60,000-byte 4bpp framebuffer，并要求 SSD2683 的 SPI 命令、BUSY 等待、上电/断电和 waveform 顺序。必须新增转换与提交层，不能把 RGB565 指针直接交给 EPD 驱动。
3. **电子墨水的刷新语义不同。** NOTE4 参考工程规定全刷建立局刷基准、局刷次数后提升为全刷，4bpp 前先做白色全刷；这些操作是同步且可能持续数百毫秒到数秒。PocketJS 的 frame/tick 仍可作为 UI 状态时钟，但 EPD presentation 必须做节流、合并 damage 和异步/阻塞边界设计。
4. **板级资源不在 PocketJS 组件内。** PR #335 的 runner 不初始化面板、不读取真实输入；NOTE4 的 GPIO、SPI、显示电源 GPIO17/6、音频、RTC、NFC、电池和 USB 都需由产品 host 接入。
5. **字体与内存需重新评估。** NOTE4 demo 内置 8x16 ASCII bitmap font；PocketJS 默认可使用 baked glyph contract。要显示中文或任意用户文本，必须提供可用字形方案，并测量 QuickJS、UI core、RGB565 临时 strip、1bpp/4bpp framebuffer 与 PSRAM 的峰值占用。

## 可行的移植形态

推荐基于 PR #335 的组件边界（待其合并或自行审阅后移植），保留 NOTE4 工程的板级驱动：

```text
PocketJS package / QuickJS guest
        |
pocketjs_ui_core + pocketjs_ui_qjs + pocketjs_runner
        |
pocketjs_render_rgb565 (软件路径，S3)
        |
NOTE4 adapter: RGB565 -> 1bpp/4bpp + damage policy
        |
zectrix_epd (SSD2683) + zectrix_board (GPIO/SPI/power/input)
```

需要实现或验证的最小 host 工作包括：

- 为 NOTE4 生成 `esp32s3` 的 host profile/contract：400 x 300 logical/physical viewport、合适的 tick/cadence、输入能力和无 PPA renderer。
- 将 RGB565 damage 区域量化/抖动到 1bpp；4bpp 仅在产品确实需要灰阶时启用，并遵守 NOTE4 waveform/base-image 状态机。
- 用 `zectrix_epd` 的同步 API 管理显示电源、BUSY 超时、局刷合并、定期全刷和关机清屏；不要让 runner 线程直接拥有 SPI/EPD 生命周期。
- 把 GPIO0/39/18 转成 PocketJS 的按钮事件，处理低电平有效、去抖、短按/长按和 GPIO18 的关机语义。
- 把电源锁存、深睡、USB 下载模式和异常退出纳入 host 的 acquire/use/release 生命周期；先备份完整 16 MiB Flash 再进行任何刷写。
- 为 S3/NOTE4 建立软件像素 golden、长时间 heap/cadence 测试、真实 EPD 视觉检查和恢复/关机测试。

## Pocket Vapor 是否更适合

不适合作为现成捷径。Pocket Vapor 的 ESP32 runtime 文档针对 Xueersi/KittenBot ESP32 MeowBit（ESP32-D0WD、160 x 128 ST7735 LCD），并说明设备上不运行 JavaScript engine；它不是通用 ESP32-S3/SSD2683 target。若选择 Vapor，仍需另建 NOTE4 board profile、SSD2683 输出、三键输入和电源管理，且只能运行编译器支持的受限 Vue subset，而非任意 PocketJS guest bundle。

来源：[`vapor/runtime/esp32/README.md`](https://github.com/pocket-stack/pocketjs/blob/0a90bf904d835210e52a11ed275a86d0040b5086/vapor/runtime/esp32/README.md)。

## 建议的验收顺序

1. **先做 host smoke，不刷真实设备：** 在 ESP32-S3 开发板上构建 PR #335 的 S3 组件，验证 QuickJS mount、UI turn、软件 RGB565 renderer、内存峰值和 package admission。
2. **接入 NOTE4 显示：** 用固定 400 x 300 测试图验证 RGB565 到 1bpp 的转换、全刷/局刷状态机、BUSY 超时和断电恢复。
3. **接入输入与电源：** 逐项验证三键短按/长按、GPIO17 电源保持、USB/BOOT/RESET 和深睡唤醒。
4. **再做 PocketJS app：** 先使用 ASCII/低色 UI，记录首帧、局刷间隔、全刷频率、heap 峰值和电池续航；中文字体、网络、音频、NFC 等能力逐项显式加入，不要默认继承。
5. **发布前门槛：** PocketJS PR #335 合并状态、S3 native archive receipt、NOTE4 实机像素/视觉结果、长时间内存与刷新测试、完整 Flash 备份/恢复流程和许可证清单全部归档。

## 最终判断

| 问题 | 判断 |
| --- | --- |
| 现在能否把 PocketJS 主线固件直接运行在 NOTE4？ | **不能**：主线 ESP-IDF 图形路径是 P4 专用，且没有 NOTE4 host。 |
| NOTE4 的 ESP32-S3 能否承载 PocketJS 的通用 guest/UI 组件？ | **技术上可以，前提是采用/移植 PR #335 的 S3 组件并自行实现 NOTE4 host。** |
| 是否已有“PocketJS on NOTE4”官方支持或实机证明？ | **没有**：未合并 PR 的验证不等于 NOTE4 支持；其 runner 示例也不含真实面板/输入。 |
| 是否建议现在刷写？ | **不建议**。先完成可恢复的 Flash 备份、独立 host bring-up 和 EPD/电源验收。 |

