# ZECTRIX NOTE4C SSD2683 四色局部刷新调查

调查日期：2026-09-01

## 结论

截至调查日期，公开渠道中没有找到可验证、可用于 NOTE4C 的四色局部刷新驱动或
LUT。ZECTRIX 公开资料和参考源码只支持 400 x 300、黑/白/红/黄、2 bpp 的整帧
刷新；没有公开矩形窗口、旧帧/新帧传输、四色局刷波形、温度分档或局刷恢复策略。

因此当前固件必须继续把全刷作为唯一受支持的面板提交方式。NOTE4 黑白面板的
SSD2683 局刷代码和 LUT 不能用于 NOTE4C。也不能把“只发送变化区域”误认为四色
局刷：即使减少 SPI 数据量，没有正确的 BWRY 驱动波形也不会安全地缩短面板激活
过程或保留红、黄粒子状态。

下一条可行路径是向 ZECTRIX 支持索取未公开资料，并要求官方明确确认当前 NOTE4C
面板 revision 是否具备“保留四色且明显快于全刷”的局刷能力。资料未取得前，不向
实机发送猜测的窗口、LUT 或激活命令。

## ZECTRIX 第一方证据

ZECTRIX 的 [NOTE4C 快速开始](https://wiki.zectrix.com/zh/hardware/note4c/quick-start)
明确给出以下硬件和刷新契约：

- 4.2 英寸、400 x 300、黑/白/红/黄四色电子墨水屏；
- SSD2683 显示控制器，2 bpp BWRY；
- 刷新项写的是“全屏刷新；每幅画面通常需要 10 秒以上”；
- “官方器件资料”只链接 ESP32-S3、PCF8563 和 ES8311 等资料，并明确说明该页
  未提供由厂商官网公开托管的 SSD2683 数据手册。

ZECTRIX [NOTE4C 产品页](https://zectrix.com/en/note4c.html)也把该设备定位为静态、
低频更新显示：全屏刷新通常超过 10 秒，不推荐实时滚动、频繁刷新的列表、手写轨迹
或游戏控制。页面解释四色粒子需要多个驱动阶段来清除残影并形成最终图像。

## 刷新时间横向比较

NOTE4C 实机约 20 秒的全屏刷新并不异常。最接近的公开一方对照是 Good Display
[GDEM042F86](https://www.good-display.com/product/1048.html)：同为 4.2 英寸、
400 x 300、SSD2683ZA、黑/白/红/黄 BWRY 四色。其规格表列出标准全刷 20 秒、
优化快刷 12 秒，工作温度为 0 至 40 摄氏度；同页还把传统四色 EPD 的刷新范围列为
20 至 26 秒。因此 NOTE4C 实测约 20 秒处于同类四色标准全刷的正常范围，但不代表
所有新款四色面板都只能达到 20 秒。

其他 Good Display 官方 BWRY 面板也显示，四色更新通常仍以十几秒计：

| 面板 | 尺寸、颜色 | 官方刷新时间 | 条件 |
| --- | --- | --- | --- |
| [GDEM042F86](https://www.good-display.com/product/1048.html) | 4.2 英寸，400 x 300，BWRY | 标准全刷 20 秒；优化快刷 12 秒 | 工作温度 0 至 40 摄氏度 |
| [Waveshare 4.2inch e-Paper Module (G)](https://www.waveshare.com/4.2inch-e-paper-module-g.htm) | 4.2 英寸，400 x 300，BWRY | 标准全刷 21 秒 | 工作温度 0 至 40 摄氏度 |
| [GDEM035F86](https://www.good-display.com/product/537.html) | 3.5 英寸，384 x 184，BWRY | 标准全刷 20 秒；优化快刷 12 秒 | 工作温度 0 至 40 摄氏度 |
| [GDEY029F52](https://www.good-display.com/product/742.html) | 2.9 英寸，296 x 128，BWRY | 标准全刷 16 秒；优化快刷 11 秒 | 刷新时间在 25 摄氏度环境测试；工作温度 0 至 40 摄氏度 |
| [GDEY0213F52](https://www.good-display.com/product/463.html) | 2.13 英寸，250 x 122，BWRY | 标准全刷 16 秒；优化快刷 11 秒 | 刷新时间在 25 摄氏度环境测试；工作温度 0 至 40 摄氏度 |

这些 11 至 12 秒数据是面板厂商明确标注的 `FAST UPDATE`，依赖该面板 revision、
控制器和匹配波形，不能据此向 NOTE4C 写入其他面板的 LUT。公开的 NOTE4C 驱动只
暴露一种四色全刷路径，并没有可选择的 12 秒四色快刷模式。

也不能把黑白或三色面板当作等价基准。Waveshare 官方
[4.2 英寸黑白模块](https://www.waveshare.com/4.2inch-e-paper-module.htm)列出全刷
5 秒、快刷 1.5 秒、局刷 0.4 秒；
[4.2 英寸黑白红三色模块](https://www.waveshare.com/4.2inch-e-paper-module-b.htm)
列出全刷 15 秒。它们的粒子体系和驱动波形都不同，不能用来判断 NOTE4C 的 BWRY
四色全刷应达到相同速度。

ZECTRIX 的[开源路线说明](https://wiki.zectrix.com/zh/software/opensource)只明确列出
可按开发用途申请硬件原理图 PDF、装配参考和特定批次资料，并没有承诺公开
SSD2683 数据手册、四色局刷 LUT 或波形。可以申请不等于已经确认存在或允许再分发。

## ZECTRIX 推荐仓库审计

Wiki 推荐的 NOTE4C 仓库是
[`LazyYoun/youn-ink-fourcolor-firmware`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware)。
本次固定审计 commit 为
[`51812e4ab3fa80ba7a5a5a274635ca2cf3901a25`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/commit/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25)。

截至该 revision，仓库只有 8 个提交、一个 `2bp` 分支，没有 tag、GitHub Release
或 GitHub Wiki。全历史和完整文件树中都没有出现 NOTE4C 四色局刷实现或 LUT。

公开 C++ 路径明确强制四色全刷：

```cpp
if (!should_full && IsFourColorPanel()) {
    should_full = true;
}
```

来源：
[`custom_lcd_display.cc#L613-L650`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L613-L650)。
四色入口严格接收完整的 30,000-byte framebuffer：
[`custom_lcd_display.cc#L1078-L1115`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L1078-L1115)。

四色面板公开时序只有：

1. `0xE9, 0x01` 初始化；
2. `0x10` 后写入 300 行 x 100 bytes，即完整 30,000-byte 帧；
3. `0x04` 上电；
4. `0x12, 0x00` 全屏刷新；
5. `0x02, 0x00` 关电；
6. `0x07, 0xA5` 深睡。

整帧写入见
[`custom_lcd_display.cc#L993-L1015`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L993-L1015)，
激活和关断见
[`custom_lcd_display.cc#L862-L899`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc#L862-L899)。
`EPD_DisplayPart()` 只属于黑白路径，四色不会调用。

仓库还包含一份原始 MSP430 示例
[`4D2_BWRY_400x300_2683_test(2)(1).c`](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/4D2_BWRY_400x300_2683_test%282%29%281%29.c)。
它同样只执行 `0x10` 完整帧写入和 `0x12` 全刷；文件中没有矩形窗口、partial
入口或 LUT。这说明缺失项不只是 ESP-IDF/C++ 封装时漏掉了功能。

公开仓库根目录的 [MIT License](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/LICENSE)
和 `firmware/` 子树的 [MIT License](https://github.com/LazyYoun/youn-ink-fourcolor-firmware/blob/51812e4ab3fa80ba7a5a5a274635ca2cf3901a25/firmware/LICENSE)
允许在保留许可声明的条件下使用已公开代码。该许可不自动覆盖未来由 ZECTRIX、
SSD2683 厂商或面板厂商单独提供的非公开数据手册、波形或 LUT；后者必须另行确认
集成和再分发授权。

## 公开实现的交叉验证

以下是社区证据，不代替 ZECTRIX 或面板厂商的正式规格，但结果与第一方源码一致：

- [`eyaeya/today-is-friday`](https://github.com/eyaeya/today-is-friday/tree/5e4c659cea99e8d4d9ee485c1bf3b908b212c497)
  的 README 明确写明“SSD2683 四色屏只做整屏刷新，没有局部刷新；单次刷新约
  18-20 秒”。
- [`LitoMore/trmnl-firmware`](https://github.com/LitoMore/trmnl-firmware/tree/c1db8b0f04fba346686a6a48a93146d49de209a9)
  的 ZECTRIX 分支仍发送完整 `0x10` 帧并以 `0x12` 刷新，而且 NOTE4C 后端设置
  `bCanDoPartial = false`。渲染配置中的其他面板名称不能证明物理 NOTE4C 支持局刷。
- [`siximuzhu/esp32-color-eink-stock-monitor`](https://github.com/siximuzhu/esp32-color-eink-stock-monitor/tree/a736cfb51f829081909e10705b88638507bf623d)
  记录了“局刷丢失红/黄且耗时相同”，其 `RefreshPartial()` 对四色面板最终退化为
  全刷。该记录只能作为失败案例，不能作为可靠波形来源。

公开的 NOTE4 黑白实验仓库确实包含 SSD2683 黑白局刷或波形，但 NOTE4 与 NOTE4C
面板和固件不可混刷。黑白 LUT 没有红、黄颜料的状态转换和温度规则，将其移植到
NOTE4C 既不能满足目标，也存在显示异常风险。

## 向 ZECTRIX 索取的完整资料

官方入口是
[ZECTRIX Technical Support](https://zectrix.com/en/support.html#contact-support)，
也可发送邮件到 `support@zectrix.com`。请求中应提供 NOTE4C 型号、PCB revision、
面板标签照片和当前参考固件 commit，并逐项索取：

1. 当前 NOTE4C 所装面板的完整料号、批次和 revision。
2. 与该硬件匹配的 SSD2683 寄存器/命令数据手册。
3. BWRY 四色 partial-update waveform/LUT，而不是 NOTE4 黑白 LUT。
4. 局刷窗口、RAM 地址和数据入口命令及其坐标/字节对齐限制。
5. 旧帧和新帧的数据格式、RAM bank、传输顺序及是否必须保存前一帧。
6. 红色、黄色粒子可否局刷；若不可，允许局刷的颜色转换矩阵。
7. 温度读取、温度分档、LUT 选择和允许工作温度范围。
8. 局刷触发、BUSY、复位、上电、关电和深睡的完整时序。
9. 连续局刷次数、残影阈值和强制全刷恢复策略。
10. 官方明确确认：该 NOTE4C 面板能否实现“保留四色且明显快于全刷”的局刷。
11. 驱动/LUT 的授权范围，以及能否集成或再分发到开源 ESP-IDF 固件。

缺少其中任何关键项都不足以形成可维护的四色局刷驱动。尤其不能只拿到控制器命令
表就开始实现；面板匹配的波形、温度策略和颜色转换约束同样必要。
最低实现门槛中的五项是：窗口/RAM 地址命令、四色 LUT/波形、旧帧与新帧规则、
局刷激活和 BUSY 时序、温度分档及 LUT 选择规则；当前五项均未满足。

## 当前工程边界

当前项目的 `zectrix_note4c_epd` 组件应继续忠实保留已经实机验证的四色全刷路径。
在获得并核验官方资料之前：

1. 不向 NOTE4C 发送 NOTE4 黑白 LUT 或推测命令。
2. 不把 framebuffer 脏矩形计算描述成面板局刷支持。
3. 通过合并状态变化、延迟提交和确认后刷新来减少全刷次数。
4. 若交互要求可见光标随按键即时移动，应改用官方支持局刷的黑白面板/设备。
