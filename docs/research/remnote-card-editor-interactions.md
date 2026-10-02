# RemNote Block 式制卡元素的显示与交互调研

调研日期：2026-07-30；Multi-Line 补充调查：2026-07-31；实现状态更新：2026-08-16

## 范围与资料边界

本文原始调研范围是先在 `packages/editor` 中实现编辑器元素与卡片预览语义：Basic、Reverse、Basic and Reverse、Cloze、List Card 与 Highlight。资料只采用 RemNote 官方帮助中心、其中的官方截图/GIF，以及 RemNote 官方 Plugin SDK；外部产品事实部分不讨论调度算法、数据库或 Electron 集成。文末的 Memorilo 状态说明已按后续实现更新。

原始 Editor-only 范围按以下语义收敛；其中 Multi-Line 已在后续 Learning 实现中继续完成：

- Cloze 只有两条作者路径：**Rich-content Cloze** 隐藏 Block 富内容中的选区，选区可以包含其他 inline 元素或整个公式；**Math-source Cloze** 隐藏 LaTeX source 内部的局部片段。Whole-math Cloze 属于前者，不再作为第三条路径。同一 ClozeGroup 可以同时包含两类 anchor，并在同一张 Card 中一起隐藏、一起揭示。
- Highlight 采用类似 SuperMemo 的记忆重点标注语义，同时支持 inline Highlight 与 whole-block Highlight。RemNote 本身不把它们定义为 Card 类型；Memorilo 则把每个连续 inline Highlight 或 block Highlight 作为来源，生成一个没有背面的 Highlight CardTopic。
- ListCard 的 Editor-only 首期先完成逐项揭示 Preview；当前正式 Learning Review 已进一步接入逐项评分、main/item 历史、Partial Card 与 FSRS 调度。

官方帮助中心页面会持续更新，本文记录的是 2026-07-30 初次访问与 2026-07-31 补充访问版本。文中将三类结论严格分开：

- **官方明确说明**：正文直接定义的产品行为；
- **官方截图观察**：可从官方截图/GIF确认的外观，但未必是稳定 API；
- **未知**：官方没有给出可依赖的行为契约。

主要资料：

- [Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
- [Flashcard Basics](https://help.remnote.com/en/articles/8663109-flashcard-basics)
- [Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)
- [Using Code Blocks on Flashcards](https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards)
- [Outlines and Terminology](https://help.remnote.com/en/articles/8196578-outlines-and-terminology)
- [Documents and Folders](https://help.remnote.com/en/articles/6030703-documents-and-folders)
- [Bullets](https://help.remnote.com/en/articles/8017859-bullets)
- [Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- [Formatting Your Notes](https://help.remnote.com/en/articles/6030579-formatting-your-notes)
- [Getting Started with Spaced Repetition](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition)
- [Hiding Ancestors on Flashcards](https://help.remnote.com/en/articles/9631727-hiding-ancestors-on-flashcards)
- [Typing in Answers](https://help.remnote.com/en/articles/7752298-typing-in-answers)
- [Setting Priorities and Disabling Flashcards](https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards)
- [Resetting Flashcard Scheduling](https://help.remnote.com/en/articles/7230389-resetting-flashcard-scheduling)
- [Changing the Direction of Multiple Flashcards](https://help.remnote.com/en/articles/14122363-changing-the-direction-of-multiple-flashcards)
- [Powerups](https://help.remnote.com/en/articles/7897630-powerups)
- [RemNote Plugin API: Card](https://plugins.remnote.com/api/classes/Card)
- [RemNote Plugin SDK 0.0.46: Card declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/card.d.ts)
- [RemNote Plugin SDK 0.0.46: Rem declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/rem.d.ts)
- [RemNote Plugin SDK 0.0.46: RichText declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/interfaces.d.ts)

## 结论摘要

1. RemNote 把卡片定义直接嵌入 Block/Bullet，而不是让用户进入单独的制卡表单。Basic 的 prompt、方向箭头与 answer 都留在同一个 Bullet 内；点击箭头即可切换类型、方向、启用状态和输入答案设置。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
2. `Basic and Reverse` 在 RemNote 中是 **Bidirectional**：一个 Bullet 生成 Forward 与 Backward 两张卡，不是一张卡在复习时随机交换正反面。官方公开 SDK 也把卡类型区分为 `forward`、`backward` 或 `{ clozeId }`。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；[Plugin API: Card](https://plugins.remnote.com/api/classes/Card)
3. Cloze 的产品模型只有 Rich-content 与 Math-source 两条作者路径。整个公式可以作为 Rich-content Cloze 的一个选中元素；只有公式内部局部删除才进入 Math-source 路径。官方 GIF 中，公式 source 会写成 `{{c1::...}}`，相同 Cloze ID 的片段一起隐藏。[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
4. Multi-Line Card 先定义“哪些直接 child Blocks 属于卡片背面”，List/Set 再定义这些成员如何揭示：普通项目符号成员默认是一次揭示全部的 Set；编号成员是按顺序逐项揭示、逐项评分的 List。缩进建立 parent/child 层级，但 child 仍需单独标为 Multi-line Card Item，不能把“是 child”“属于卡片背面”“是 numbered List item”合并成一个状态。Memorilo 的 CardTopic Preview 使用 `CardPreview`，正式 Review 使用只读 `CardSurface`；二者共享 CardTopic-owned projection，正式 Review 已补齐逐项评分、历史和 Partial 调度。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)；[SDK Rem declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/rem.d.ts)
5. RemNote 官方没有名为 **Highlight Card** 的卡片类型。相关的“Highlight”实际有三义：inline 文字 Highlight/Text Color、整 Bullet 背景 Highlight Powerup、Multiple Choice Review 的 AI 按钮 `Highlight key information`。Memorilo 采用前两种作为 authoring 语义，但在自己的领域模型中为每个连续 inline 区域或 whole-block Highlight 创建 child CardTopic；该 Highlight Card 没有背面，直接使用四级 Rating。这是 Memorilo 的明确偏离，不是 RemNote 行为。[Formatting Your Notes](https://help.remnote.com/en/articles/6030579-formatting-your-notes)；[Powerups](https://help.remnote.com/en/articles/7897630-powerups)；[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
6. 官方 SDK 0.0.46 明确把 Card `_id` 定义为 Card ID，并说明 `remId` 是来源 Rem 的内部 UUID、稳定且永不改变；这证明 RemNote 至少分离了 Card 身份与来源 Block 身份。但官方仍没有公开 CardID 的生成与重建算法，也没有保证方向切换、Cloze 重编号或 List 子项移动后 Card `_id` 如何变化。`c1` 是 Cloze 分组标识，不能当作全局稳定 CardID。[Plugin API: Card](https://plugins.remnote.com/api/classes/Card)；[SDK Card declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/card.d.ts)；[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)

## 1. 类型与交互总表

| 元素 | 作者输入 | 编辑器显示 | Preview / Review | 主要设置与交互 |
| --- | --- | --- | --- | --- |
| Basic / Forward | `prompt >> answer` 或 `prompt == answer` | 分隔符变为指向右侧的箭头；两侧内容仍在同一 Bullet | Front 只显示 prompt；`Show Answer` 后显示 answer | 点击箭头配置 Single Line/Multi-Line、方向、Enable Cards、Type In Answer，也可 Delete Card |
| Reverse / Backward | `answer << prompt`，或在箭头菜单选择 Backward | 箭头改为向左 | Front 显示原 answer，要求回忆原 prompt | 可在箭头菜单、Omnibar 或快捷键切换 Backward |
| Basic and Reverse / Bidirectional | `prompt <> answer`，或选择 Bidirectional | 显示双向箭头 | 生成 prompt→answer 与 answer→prompt 两个复习方向 | Forward 与 Backward 可分别 toggle |
| Rich-content Cloze | 选择 Block 富内容后点 Cloze；选区可包含文字和其他 inline 元素，整个公式也走此路径 | 被标记内容仍可读；官方截图中为浅蓝底/蓝色下划线，并带分组控件 | 当前 Cloze 替换为蓝色空缺；`Show Answer` 后揭示 | 同一 Block 的多个片段可分别成卡，也可归入同一 ClozeGroup |
| Math-source Cloze | 在公式编辑框中选中 LaTeX 片段，点 `Create Cloze` | 源码形如 `e^{i\pi} + {{c1::1}} = 0`；渲染仍是完整 KaTeX 公式，Cloze 片段着色 | 公式其余部分继续排版，空缺显示为蓝色 `[…]` | `Alt`+点击可把多个公式片段合到同一卡；也可手工统一 `cN` |
| Multi-Line Set | 卡片触发符后按 Enter、使用三连触发符，或把已有直接 children 标为 Multi-line Card Item | 父节点是 prompt；明确加入 Back 的 child Blocks 是 answer members；成员可以包含 Code Block 等原有 Block 元素 | 默认一次揭示所有成员 | 忘记个别项时点该项的 `X` 标红，再为其余项评分 |
| Multi-Line List / List Card | 建立 Multi-Line 后把成员 children 改为 Numbered List，或在第一项输入 `1.` | 父节点是 prompt；同时具有 Card Item membership 与 numbered-list 表现的 children 是有序答案 | Preview 按序揭示；正式 Review 每揭示一项就评分 | 完整复习原子更新 main/item 历史，困难项进入 Partial Review |
| Highlight | 选中文字使用颜色工具；整 Bullet 用六点菜单或 `/red`、`/green` 等命令 | 同时支持 inline highlight 与整 Block 背景 Highlight | RemNote 只保留标注；Memorilo 由 child CardTopic Preview 该片段，并在 Review 中直接评分 | RemNote 不生成 Card，也不使用 Review hint 语义；Memorilo 为每个来源区域生成无背面的 Highlight Card，见结论 5 |

Basic、Reverse、Bidirectional 与 Cloze 事实来自 [Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；List/Set 来自 [Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)；公式 Cloze 来自 [Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)；Highlight 来自 [Formatting Your Notes](https://help.remnote.com/en/articles/6030579-formatting-your-notes) 与 [Powerups](https://help.remnote.com/en/articles/7897630-powerups)。

## 2. Basic、Reverse 与 Basic and Reverse

### 2.1 作者体验

Basic 的默认语法是 `prompt >> answer` 或 `prompt == answer`。输入完成后，原始字符被视觉箭头替代，但 prompt 和 answer 仍是同一 Bullet 的可编辑内容。快捷语法 `<<` 创建反向卡，`<>` 创建双向卡，`=-` 创建暂不练习的卡。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

点击箭头会打开就地配置菜单。2026-07 的官方截图显示以下项目：`Flashcard Type`、`Flashcard Direction`、`Enable Cards`、`Type In Answer`、`Delete Card`；Bullet 右端另有 Preview 按钮。改变方向后，Bullet 中的箭头方向也同步改变。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

批量操作时，可以选中多个 Bullets，通过 Omnibar 的 `Practice Forward` / `Practice Backward` 命令或 `Cmd+Shift+G` / `Cmd+Shift+B` 分别 toggle 两个方向；命令语义是 toggle，而不是强制设值。[Changing the Direction of Multiple Flashcards](https://help.remnote.com/en/articles/14122363-changing-the-direction-of-multiple-flashcards)

### 2.2 Review 行为

正常 Review 流程统一为：先显示 Front，用户主动回忆，点击 `Show Answer`，再看到 Back 并评分。Basic Forward 的 Front 是 prompt；Backward 的 Front 是原 answer；Bidirectional 则从同一 Bullet 生成两个方向的卡。[Getting Started with Spaced Repetition](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition)；[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

Type In Answer 是可选交互。它可以只对当前卡、当前文档或整个 Knowledge Base 启用，也可在编辑器里用 `/tia` Powerup 作用于 Bullet 及其 descendants。输入框只出现在正式 Queue，不出现在箭头打开的 Preview；公式答案输入的是 LaTeX source，但卡面仍显示渲染公式。[Typing in Answers](https://help.remnote.com/en/articles/7752298-typing-in-answers)

禁用卡片不会删除编辑器中的内容。箭头菜单关闭 `Enable Cards` 后，箭头变成平线；也可在箭头后输入 `-`，或用 `Cmd+Opt+F` toggle。Queue 中可以只禁用当前卡，或禁用同一 Bullet 生成的所有卡。[Setting Priorities and Disabling Flashcards](https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards)

### 2.3 对稳定身份的证据边界

官方公开 SDK 的 Card 具有 `_id`、`remId`、`type`、`createdAt`、复习历史和下次复习时间；类型明确区分 Forward、Backward 与 Cloze。其 0.0.46 类型声明把 `_id` 注释为 Card 的 ID，把 `remId` 注释为生成该 Card 的 Rem 的内部 UUID，并明确保证后者稳定且永不改变。一个 Rem/Bullet 可以通过 `getCards()` 返回多张 Card。[Plugin API: Card](https://plugins.remnote.com/api/classes/Card)；[SDK Card declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/card.d.ts)

但官方没有说明从 Forward 改为 Backward、关闭后再重新启用方向、Delete 后 Undo，或从单向切换为 Bidirectional 时，旧 Card `_id` 和历史如何迁移。因此 Memorilo 不能把 RemNote 的当前 UI 行为当作 CardID 算法规范。

## 3. Cloze

### 3.1 Rich-content Cloze

RemNote 中最常见的入口是选中文字后点击格式工具栏的虚线方框图标，或直接按 `{`；输入时也可以先写 `{{`、输入内容，再以 `}}` 结束。编辑器仍显示原内容，不会真的把笔记正文挖空。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

Memorilo 将这一路径定义得更准确：它不是只允许纯文字的 `Text Cloze`，而是作用于 Block 富内容选区的 **Rich-content Cloze**。选区可以包含其他 inline 元素；选择整个公式时，公式作为一个完整元素被隐藏，也属于这条路径。首期不把跨 Block 的结构选区纳入该定义。

官方截图中，Cloze 内容表现为浅蓝背景或蓝色下划线，右侧带小下拉箭头。一个 Bullet 内可以有多个 Cloze；每个下拉菜单用于决定“分别隐藏并生成独立卡”还是“合并后同时隐藏在同一卡”。同一 Bullet 还可以同时生成 Basic 与 Cloze 卡。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

Review Front 保留 Bullet 其余文本，仅把当前分组替换为蓝色空缺。Cloze 可以拥有独立 hint；同一 Bullet 的不同 Cloze 可分别设置 hint，Queue 中 hint 显示在空缺位置。[Mastering Flashcards with Effective Hints](https://help.remnote.com/en/articles/9626898-mastering-flashcards-with-effective-hints)

### 3.2 Math-source Cloze

RemNote 的公式使用 KaTeX。作者在任意 Bullet 输入 `$$` 打开公式编辑框；公式可在 Inline 与 Block 模式间切换，点击公式或用方向键移动到公式上可重新编辑。粘贴时，单 `$...$` 识别为 inline math，双 `$$...$$` 或 `\[...\]` 识别为 block math；inline dollar 语法要求美元符号外侧有空格。[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)

RemNote 官方在公式上展示了两种操作：

1. 把整个公式对象作为 Cloze；在 Memorilo 中它属于 Rich-content Cloze；
2. 打开公式编辑器，在 LaTeX source 中选中局部片段，点击 `Create Cloze`；这才是独立的 Math-source Cloze 路径。

[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)

官方 GIF 可观察到，局部公式 Cloze 直接写入 LaTeX source，例如：

```latex
e^{i\pi} + {{c1::1}} = 0
```

编辑器完成后仍按 KaTeX 渲染；Review 时只把 `1` 替换为蓝色 `[…]`，等号与公式其余部分保持正常数学排版。按住 `Alt` 点击 `Create Cloze` 会把多个片段合并到同一卡；也可以手工修改 `c1::` 中的数字，相同 Cloze ID 一起隐藏。[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)

这说明公式节点作为完整富内容元素时可以由 Rich-content Cloze 隐藏，而公式 source 内部仍需要独立的局部 anchor 和 ClozeGroup。把渲染后的公式先转成普通文本再套 Cloze，会丢失 RemNote 已明确支持的编辑行为。

官方 SDK 的 RichText 类型也体现了这条边界：普通富内容元素用 `cId` formatting 表示 Cloze；LaTeX 元素则同时拥有可选的 `cId` 和 `latexClozes`。前者可表示整个公式参与 Rich-content Cloze，后者承载公式 source 内部的 Math-source Cloze。因此 Math-source Cloze 不应建模为跨过 math atom 的普通文本 mark。[SDK RichText declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/interfaces.d.ts)

### 3.3 两条路径的组合边界

已知：

- 一个 Bullet 可以同时包含普通文本和公式；
- 普通文本可以有多个 Cloze；
- 公式整体可以成为 Cloze；
- 公式内部可以有多个独立或合并的 Cloze；
- 一个 Bullet 可以同时生成 Basic 与 Cloze。

[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；[Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)

Memorilo 已确认：

- Rich-content Cloze 的选区可以包含其他 inline 元素，也可以把整个公式作为一个元素隐藏；
- LaTeX source 内部的局部删除必须使用 Math-source Cloze；
- 两条路径共享稳定 CardID 与 ClozeGroup 概念，但 anchor 类型不同。
- 同一 ClozeGroup 允许混合 RichContentAnchor 与 MathSourceAnchor；Preview 必须将两类片段一起隐藏，并在 Show Answer 后一起揭示。

该组合的分组控件、空缺表现和 reveal 交互直接参照 RemNote。由于官方资料没有明确演示“公式外选区与公式 source 内部选区共享同一分组”，混合 anchor 是 Memorilo 已确认的产品契约，而不是本文声称的 RemNote 公开数据契约。

仍未决定：

- 在 inline/block math 间切换是否保留 Card 身份；
- 修改公式 source 导致 range 偏移时，Cloze 如何重定位；
- 删除、插入或手工重编号 `cN` 后，原复习历史如何映射；
- 嵌套 Cloze 是否有效。

因此 `c1` 只能视作当前 Block/卡片定义中的 Cloze group ID，不能代替稳定 CardID。

## 4. Multi-Line Card、Set 与 List Card

### 4.0 补充调查（2026-07-31）：Question / Answer 的 Block 结构

#### 官方明确说明

Single-Line Basic 把 prompt、箭头和 response 放在同一个 Bullet 中；Multi-Line Card 则把父 Bullet 作为 prompt，把明确加入卡片背面的直接 child Bullets 作为 answer。输入任意卡片触发符后按 Enter，会把光标放到“new answer”的第一行；已有 outline 也可选中 children 后 toggle `Multi-line Card Item`。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

因此 RemNote 中的 Question 与 Answer **不要求都在同一行**。Forward Multi-Line 的 Front 是父 Bullet，Back 是多个成员 children；Backward 会先显示所有成员 children，要求回忆它们的 immediate parent；Bidirectional 则练习这两个方向。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

Multi-Line membership 与普通 outline 层级不是同一状态。缩进只建立 parent/child 关系；child 还可以通过 `/multi-line card item`、`Add to Back of Card`、`Remove from Back of Card` 单独加入或移出卡片背面。公开 SDK 也分别提供 `isCardItem()` / `setIsCardItem()` 与 `isListItem()` / `setIsListItem()`，说明“是否为 Multi-Line Card 成员”和“是否以 numbered list item 表现”是两个独立维度。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)；[SDK Rem declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/rem.d.ts)

Multi-Line member 不是只能承载普通文字。官方专门说明 Code Block 不能与箭头放在同一 Bullet 内，但可以作为 Multi-Line Card 的 child 放在 Back；即使背面只有这一个 Block，也仍是合法的 Multi-Line Card。若要把 Code Block 放在 Front，官方做法是把它放在卡片 Bullet 的 ancestor hierarchy 中，作为 Review context 显示。[Using Code Blocks on Flashcards](https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards)

RemNote 中缩进本身具有明确的知识结构语义：缩进表示上方 Bullet 的 subpart，并形成 parent、child、ancestor 与 descendant 关系；改变层级可能改变周围卡片所显示的内容。RemNote 的 Document 仍是“以不同方式显示的普通 Bullet”，可以位于任意层级并拥有更多缩进层级；严格限制只能容纳 Documents/Sub-folders 的是 Folder，而不是 Document。[Outlines and Terminology](https://help.remnote.com/en/articles/8196578-outlines-and-terminology)；[Documents and Folders](https://help.remnote.com/en/articles/6030703-documents-and-folders)；[Bullets](https://help.remnote.com/en/articles/8017859-bullets)

#### 官方截图 / GIF 观察

- Editor 截图中，Multi-Line 父 Bullet 末尾是向下箭头，左侧竖线从父节点延伸并包围其 answer children；选中一个成员 child 时，工具栏显示 `Remove from Back of Card`。这能确认 membership 有持续可见的范围提示，也能逐 child 调整，但截图不是公开 schema 契约。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)
- Set GIF 的 Front 用一个带成员数量的折叠区域占位，`Show Answer` 后一次展开全部项目；List GIF 则保留编号位置，每次只揭示当前项并评分，再进入下一项。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)
- Recursive 示例中，顶层问题、数字 children 与字母 grandchildren 都维持原 outline 缩进；父节点与可递归测试的 child 节点各自显示 Multi-Line 向下箭头。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

#### 未知与实现边界

- 官方只明确展示“一个 parent prompt + 若干 member children answer”。没有证据表明 Forward prompt 可以由任意多个 sibling Blocks 共同组成，也没有证据表明两侧都能各自由任意 Block range 组成。
- Backward Multi-Line 的 Front 确实是多个 child Blocks，但这来自方向翻转，不代表作者模型中另有“Multi-Block Question Definition”。Code Block 出现在 Forward Front 时，官方使用的是 ancestor context，也不是把多个 Blocks 合并进 prompt definition。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)；[Using Code Blocks on Flashcards](https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards)
- 官方没有说明 membership 在内部究竟存储为 parent-child edge metadata、child attribute、Powerup 还是 Card-owned list；公开 SDK 只能证明 Card Item 与 List Item 可独立查询和修改。
- 混合 numbered、bulleted、Code Block 等不同类型成员时采用 List 还是 Set，以及 reparent 后 membership 是否保留，官方资料没有定义。

对 Memorilo 的直接含义是：如果 Document 模式继续禁止普通 Block 任意缩进，仍可由明确的 `Convert to Multi-Line` / `Add to Card Back` 操作创建合法的 direct-child 结构并设置 membership；这是一条受语义约束的结构命令，不等于全面开放普通 Tab 缩进。Card 需要复用原有 Block 内容能力，而不能把 Multi-Line answer 限定成新的 Card-only item 节点。这里是基于 RemNote 行为得出的 Memorilo 设计建议，不是 RemNote 的公开实现契约。

### 4.1 创建与编辑器结构

Multi-Line Card 可通过三种主要方式创建：输入 `>>` 等卡片触发符后按 Enter；使用三连触发符如 `>>>`；或选中已有 children，执行 `/multi-line card item` / `Cmd+Opt+R`。已有 Multi-Line Card 也可以通过选择 child 后点击 `Add to Back of Card` 或 `Remove from Back of Card` 调整成员。因此只有明确带 membership 的直接 children 是 Back，不应把父 Block 的所有普通 children 自动投影为答案。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

成员 children 是普通项目符号时，默认是 **Set Card**，Back 一次揭示全部 items；把成员 children 改为 Numbered List，或在第一项输入 `1.`，就变成 **List Card**，Back 按顺序逐项揭示。这里是 membership 与 list presentation 的联动，不是“看到任何 ordered children 就自动创建 ListCard”。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)；[SDK Rem declarations](https://unpkg.com/@remnote/plugin-sdk@0.0.46/dist/name_spaces/rem.d.ts)

### 4.2 Review 不是单次 Show Answer

List Card 每次只揭示当前项，并立即让用户为该项评分；随后进入下一项。Set Card 一次显示全部项目，但用户若忘记其中几项，要点击各项旁的 `X` 把它们标红，再为剩余记住的项目评分；全部忘记时可以再次选择 `Forgot`。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

当某些项目反复困难，RemNote 会在 Queue 中生成 Partial List/Set Card，只隐藏一个特定项目；待困难项掌握后，完整 List/Set Card 才重新出现。这是 List Card 的核心学习交互，而不只是一个编号列表视觉。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

Multi-Line 同样支持 Forward、Backward、Bidirectional 或 Disabled。Backward Front 会显示所有 child items，要求回忆它们的直接 parent。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

### 4.3 递归与展开状态

Multi-Line 的 child 自己也可以是 Multi-Line Card。顶层卡默认只显示直接 children，不显示 grandchildren；Preview/Queue 中可以点展开三角显示更深层级。展开状态会持久化，而且 Queue/Preview 的状态与 Editor 的折叠状态分别保存。[Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)

官方未公开：List item 是否拥有独立稳定 CardID、Partial Card 的身份如何派生、children 重排是否保持历史、child 移动到另一个 parent 后如何迁移历史。因此 Memorilo 若要稳定身份，List item 应依赖稳定 Block ID，而不能依赖文本或数组下标。

### 4.4 Memorilo 的实现状态

Editor-only Preview 里程碑已经完成：ListCard 从 Front 开始，每次 reveal 只展示下一个有序 item，直到全部 items 展示完毕；Preview 本身仍不写学习历史。

正式 Learning Review 已完成后续闭环：forward List/Set 同时投影 whole main Target 与稳定 item Targets；完整 List 逐项收集评分并在最后一个 item 后原子提交，完整 Set 区分遗忘项和其余项；困难 item 使用 Partial Review，main 与 items 都由 FSRS 调度。详细契约见 [FSRS Learning System Design](../fsrs-learning-system.md) 和 [RemNote List/Set 两层调度调研](./remnote-list-set-review-scheduling.md)。

## 5. Highlight 的三种含义

### 5.1 它不是官方 Card Type

RemNote 的官方卡片类型列表中没有 Highlight Card。“Highlight”至少有三种互不相同的产品含义，不能共用一个模糊的数据类型。

与编辑器相关的前两种是：

- 选中 Bullet 内的一段文字后，通过 `A` 加彩色点的按钮设置 inline Highlight / Text Color；
- 对整个 Bullet 通过六点抓手菜单或 `/red`、`/green` 等命令设置背景 Highlight。

[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；[Formatting Your Notes](https://help.remnote.com/en/articles/6030579-formatting-your-notes)

整 Bullet Highlight 在内部是一个 Powerup，并带有 `Color` 属性。官方列出的属性值为 Red、Orange、Yellow、Green、Blue、Purple；`/no highlight` 可移除。Powerup 是对同一 Bullet 增加行为/表现，不生成新的 Card。[Powerups](https://help.remnote.com/en/articles/7897630-powerups)

第三种是 `Highlight key information` 按钮，但它只出现在 Multiple Choice Review：点击后把题面关键短语标黄并把按钮改为 `Hide key information`。这不是作者创建的 Highlight 元素，也没有证据表明 Basic、Cloze 或 List Card 共享该功能。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

### 5.2 未定义的显示边界

官方明确展示了 Highlight 在 Editor 中的外观，也说明打印时默认不包含背景色，需在打印选项中启用 Background Graphics。[Formatting Your Notes](https://help.remnote.com/en/articles/6030579-formatting-your-notes)；[Printing Highlights](https://help.remnote.com/en/articles/7225434-printing-highlights)

Memorilo 已采用类似 SuperMemo 的记忆重点标注语义：inline Highlight 与 whole-block Highlight 在 regular Topic 的 authoring editor 中保留原样式；每个连续 inline 区域或 whole-block Highlight 生成一个 child CardTopic。该 child 只保留来源片段，拥有一个无背面的 Highlight Card，并在正式 Review 中直接使用 Again、Hard、Good、Easy 评分。Multiple Choice 的 `Highlight key information` review hint 不在当前范围。

## 6. 所有卡片共享的 Context 与 Preview 语义

RemNote Review 默认显示来源 Bullet 的全部 ancestors，包括文档标题/面包屑和 outline 中的上级 Bullets。这让作者可以把背景信息留在层级中，不必复制进每张 prompt；但 Basic ancestor 的 answer 也可能显示，从而泄题。[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

若某 ancestor 的全文与当前 Card answer 完全相同，RemNote 会在 Front 自动把它隐藏为省略号；只部分重合时不会自动识别。Preview/Queue 中悬停文档名可以隐藏 breadcrumb 与文档标题，再点击 `…` 恢复；文档内部 ancestors 仍保留。[Hiding Ancestors on Flashcards](https://help.remnote.com/en/articles/9631727-hiding-ancestors-on-flashcards)

官方文档区分的是 Editor、Flashcard Preview 与 Flashcard Queue，没有给出单独的 `read mode` 外观规范。实现时不应把截图中的 Preview 布局自动推广为文档只读模式契约。

## 7. 身份与内容更新

第一方资料能确认：

- 一个 Bullet 可以生成多张 Card；
- Bidirectional 有两个方向；
- 多个独立 Cloze 可从一个 Bullet 生成多张 Card；
- 同一 Bullet 可同时生成 Basic 与 Cloze；
- Queue 菜单区分“Disable this card”和“Disable all N cards from this bullet”；
- 大幅改写正文后，RemNote 要求用户自行决定是否 Reset Scheduling，说明普通内容编辑不会自动清空全部复习历史；
- Reset 通过新增 Reset history entry 使旧记录不再参与调度，但旧记录仍保留用于分析。

[Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)；[Setting Priorities and Disabling Flashcards](https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards)；[Resetting Flashcard Scheduling](https://help.remnote.com/en/articles/7230389-resetting-flashcard-scheduling)

第一方资料不能确认：

- CardID 的格式与生成方式；
- Forward、Backward、Bidirectional 切换时 CardID/历史如何迁移；
- Cloze 增删、重排、改 `cN` 时 CardID/历史如何迁移；
- List child 重排或 reparent 时身份如何迁移；
- Delete 后 Undo 是否恢复原 CardID；
- 同一 Bullet 中 Basic 与 Cloze 的 ID 如何派生。

因此对 Memorilo 更安全的概念分离是：

```text
BlockID              内容来源的稳定身份
CardID               每个可独立复习方向/分组的稳定身份
CardKind             basic-forward / basic-backward / cloze / list ...
ClozeGroupID         同一卡上同时隐藏哪些片段
RichContentAnchor    Block 富内容中的 range / relative anchor，可覆盖完整 inline 元素
MathSourceAnchor     公式节点 ID + LaTeX source 内部 anchor
ListItemBlockID      List/Set 中每个答案项的稳定 Block 身份
```

这不是对存储方案的最终决定，而是从 RemNote 已公开行为得出的最小概念边界。特别是 `CardID` 与 `ClozeGroupID` 不能合并。

## 8. 自动化验证

Card authoring 行为直接由 `packages/editor/src/card/*.test.*` 和 Document interaction tests 验证，不保留独立 Card Lab。纯 ProseMirror transaction command 通过 Node 内存 schema 在模块接口处验证；NodeView、输入、键盘和 selection 交互继续使用带稳定 BlockID/CardID 的浏览器 Editor harness。

长期 Note lifecycle tests 另覆盖 Basic、List、Set、Cloze、inline Highlight、block Highlight 的 child CardTopic 创建、来源同步、编辑解除同步、resync、来源删除保留，以及 Cloze/Highlight 相互嵌套。Desktop main integration tests 贯穿 CardTopic 持久化、regular source Topic 队列排除、child 的 new/learning/review queue、Again/Hard/Good/Easy rating、detached child 继续学习、nested grandchild 学习与来源删除后的评分。

## 9. Memorilo Editor 的原始实现顺序

以下顺序记录 Editor-only 阶段采用的实现路径；它不再表示当前待办：

1. **Card delimiter element**：同一个 Block 内保留前后富文本，支持 Forward、Backward、Bidirectional、Disabled 四种箭头状态。原始阶段曾提供 regular Topic 就地 Preview；当前 Preview 只由 child CardTopic 提供。
2. **独立 CardID**：Bidirectional 一开始就分配两个 CardID；方向 toggle 只改变 active 状态，不用方向符号临时计算身份。
3. **Rich-content Cloze + group**：编辑器显示原内容和分组控件，选区允许包含完整 inline 元素或整个公式，Preview 根据当前 group 做 projection。
4. **Math-source Cloze**：在公式 source 内维护局部 anchor；它与 Rich-content Cloze 共享 Card/ClozeGroup 语义，但不共享同一种位置表示。
5. **Multi-Line membership**：使用 direct child BlockID 维护显式 Back membership，不把普通层级 children 自动视为答案；成员继续使用原有 Block 类型。Set/List 是建立在 membership 之上的 reveal 维度，其中 numbered-list presentation 触发逐项揭示。CardTopic Preview 与正式 Learning Review 均已接入，后者包含逐项评分、main/item 历史、Partial Card 和 FSRS 调度。
6. **Highlight formatting**：同时实现 inline mark 与 whole-block presentation attribute；当前每个来源区域会生成 Highlight CardTopic 和 `highlight` Card projection，Review 无背面并直接评分。
7. **Context projection**：当前 CardTopic 只复制所选来源片段，不复制 ancestors；完整 ancestor context 仍是后续 Preview/Review 边界。

这里最不应简化的是公式 Cloze：RemNote 的官方行为已经表明，它不是“把整个公式当不可编辑图片”，而是允许在保留 KaTeX 排版的同时，对 LaTeX source 的局部内容建立可分组的 Cloze。

## 10. 当前决策与剩余边界

1. Cloze authoring 为 Definition、Card 和 Group 写入独立稳定 ID，普通内容编辑不改变 CardID。当前没有把既有 anchor 重新分配到另一个 ClozeGroup 的产品操作，因此这类显式 regroup 对历史的语义仍未定义。
2. Bidirectional 的 forward/backward CardIDs 在方向和 List/Set presentation 切换时保持不变；禁用后重新启用同一方向会恢复原 CardID 与既有学习历史。这是 Memorilo 已采用的合同，不声称来自 RemNote 公开规范。
3. 每个 Basic/List/Set Definition、ClozeGroup、连续 inline Highlight 和 block Highlight 创建一个 child CardTopic；regular Topic 不进入队列且不提供 Preview。CardTopic 默认 synced，编辑或删除来源会 detached，toast Undo 可 resync；child 可继续生成嵌套 CardTopic。
4. CardTopic Preview 使用 `CardPreview`，正式 Review 使用只读、focused CardSurface；二者都只读取当前 CardTopic 拥有的 Card projection。完整 ancestor context、自动防泄题、独立折叠状态和返回 Source Block 的导航仍是后续边界。
5. CardTopic ownership 不改变主数据库的 migration generation；learning schema generation 独立维护。
