# Anki、RemNote 与 SuperMemo 学习系统调研

调研日期：2026-07-30；实现状态更新：2026-08-16

本文保留当时用于选择产品路线的外部调研与阶段计划。Memorilo 后续已经选择原生 FSRS，并完成 CardTopic ownership、学习存储、队列、Optimizer 和正式 Review UI；当前实现合同以 [FSRS Learning System Design](../fsrs-learning-system.md) 与 [ADR 0006](../adr/0006-card-topics-own-learning-cards.md) 为准。

## 范围与资料边界

本文只使用产品官方手册、官方帮助中心和官方源码等一手资料，比较：

- 学习模型；
- note、card、item 等内容结构；
- 调度算法与用户控制；
- 渐进阅读与知识链接；
- 复习流程；
- 同步与数据可携带性；
- 对 Memorilo 的产品启示与风险。

Anki 手册固定在官方仓库提交 [`d2484ca416682d9a7c39fdca1d8fd34ab75bf22b`](https://github.com/ankitects/anki-manual/tree/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b)。AnkiConnect 固定在官方 SourceHut 仓库提交 [`de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e`](https://git.sr.ht/~foosoft/anki-connect/tree/de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e)。RemNote 帮助中心和 SuperMemo 静态手册为 2026-07-30 访问版本。

SuperMemo 需要特别限定范围：本文研究的是仍可公开访问的经典 Windows 产品 SuperMemo 17 与 SM-17，因为这条产品线提供了 incremental learning、knowledge tree 和算法的完整一手说明。SuperMemo.com 是另一套偏在线课程的云产品，不能用其同步能力推断经典 Windows 产品的能力。新版经典产品 Wiki 在调研时阻止自动访问，因此本文不声称 SM-18/SM-19 的具体实现或当前同步能力。

文中“产品事实”均来自所附资料；“对 Memorilo 的判断”是基于事实的产品推论，不代表原产品官方结论。

## 结论摘要

三者解决的不是完全相同的问题：

| 产品 | 内容真源 | 调度单位 | 最突出的能力 | 主要代价 |
| --- | --- | --- | --- | --- |
| Anki | Note + fields | 从 note template 生成的 card | 成熟、可塑、可移植的卡片与复习系统 | 笔记、模板、card、deck、preset 概念较多，知识加工链较弱 |
| RemNote | 层级 bullet | 从 bullet 生成并保持关联的 flashcard | 笔记、链接、阅读和制卡在同一知识库闭环 | 节点同时承载层级、链接、优先级和调度继承，行为解释成本高 |
| SuperMemo 17 | knowledge tree 中的 element | 主动回忆 item；被动阅读 topic 另行调度 | 把“尚未消化的信息”也纳入有优先级的渐进加工队列 | 工作流和界面复杂，学习曲线、信息过载和数据管理成本高 |

最值得 Memorilo 保留的共同边界是：**知识内容与复习状态不能是同一个对象，但必须有稳定关联**。Anki 将 Note 与 Card 明确分开；RemNote 从 bullet 生成 card；SuperMemo 将可继续加工的 Topic 与用于主动回忆的 Item 区分开。

调研阶段曾把 AnkiConnect 作为快速验证路线；它只能把 Anki 当作外部 card store 和 scheduler，不是后台同步协议。Memorilo 当前已经选择并实现原生 FSRS，Card identity、Review Event history、Learning State、due 与下一间隔均由 Memorilo 管理。远端个人学习同步仍是后续边界。

## 1. Anki

### 1.1 内容与学习模型

Anki 的 `Card` 是一次问答展示，而内容真源是 `Note`。Note 由 fields 组成；Note Type 定义 fields 以及一个或多个 Card Types，每个 Card Type 用正反面 template 从同一个 Note 生成一张 Card。因此同一条内容可生成正向、反向或其他 sibling cards；修改 Note 会更新所有相关 Card。[Anki Manual: Cards, Notes & Fields, Card Types](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/getting-started.md#cards)

标准 Note Types 包含 Basic、可选/固定反向、输入答案、Cloze 和 Image Occlusion。Notes 和 Note Types 属于整个 collection，并不归属于某个 deck；由同一 Note 生成的不同 Cards 也可以进入不同 decks。[Anki Manual: Note Types](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/getting-started.md#note-types)

Deck 是 Card 的学习分组和设置边界，可以形成子 deck 树。Card 会经历 New、Learning、Review、Relearn 状态；Review Card 的 interval 到期后再次出现，答错则进入 Relearn。[Anki Manual: Card States and Decks](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/getting-started.md#card-states)

### 1.2 调度与用户控制

Anki 当前提供 FSRS，并保留 legacy SM-2。FSRS 的关键用户参数是 desired retention：默认 90%，提高它会缩短间隔并增加日常复习量，接近 100% 时工作量快速上升。FSRS parameters 可根据 review history 优化；parameters 和 desired retention 属于 preset，但 FSRS 的开关是 collection 全局级，不能只为某些 preset 启用。[Anki Manual: FSRS](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/deck-options.md#fsrs)

Anki 还暴露大量调度政策：learning/relearning steps、每日新卡和复习上限、显示顺序、sibling burying、Easy Days、maximum interval，以及 legacy SM-2 的 ease、interval modifier 等。FSRS 文档明确提醒：忘记时误按 Hard 会破坏其假设并产生过长间隔；会改变 interval 的 add-on 通常也不应与 FSRS 混用。[Anki Manual: Deck Options](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/deck-options.md)

这说明调度器不只是一个日期公式，还包含：card state machine、短期学习步骤、复习上限、队列顺序、兄弟卡抑制和用户评分语义。

### 1.3 复习流程

复习时先只显示 question；用户主动回忆后显示 answer，再选择：

- `Again`：未能回忆或答案错误；
- `Hard`：正确但迟疑或费时；
- `Good`：正确且需要一定努力；
- `Easy`：正确且不费力。

每个按钮显示选择后预计的下次复习时间；用户也可以只使用 Again/Good。Anki 会加入少量不可关闭的 fuzz，避免同时引入且同评分的卡片永久粘连。[Anki Manual: Answer Buttons and Fuzz Factor](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/studying.md#answer-buttons)

复习中还可以编辑 Note、bury Card/Note 到下一天、suspend、reset、set due date。相关 sibling cards 可自动 bury，即使它们不在同一 deck。[Anki Manual: Editing and More; Siblings and Burying](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/studying.md#editing-and-more)

### 1.4 知识链接与阅读加工

官方核心手册将 Anki 建模为 notes、cards、decks、templates 和 collection，并未描述内置 incremental reading 或一等知识图谱。由此只能得出产品边界上的判断：Anki 的一手资料重点是卡片生成和调度；不能仅因核心手册未描述某功能，就断言 add-on 生态中不存在类似能力。

### 1.5 同步与可携带性

AnkiWeb 在初次单向同步后可以合并普通 reviews 和 Note edits。如果同一 Card 在两端复习，两次 review 都保留在 history 中，Card 采用最近一次回答后的状态。添加 field、移除 card template 等 Note schema 变更不能总是合并，可能要求选择一端进行 one-way sync。媒体有独立的合并流程。[Anki Manual: Syncing and Conflicts](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/syncing.md)

导出格式包括：

- tab-separated plain text Notes，包含内嵌 HTML formatting；
- `.colpkg` 完整 collection，包含全部 decks 和 scheduling，导入时替换当前 Cards；
- `.apkg` 单 deck package，包含 Cards、Notes、Note Types，可选择携带 scheduling、presets 和 media，导入时合并进 collection。

[Anki Manual: Exporting](https://github.com/ankitects/anki-manual/blob/d2484ca416682d9a7c39fdca1d8fd34ab75bf22b/src/exporting.md)

### 1.6 对 Memorilo 的判断

值得学习：

1. 把知识源 Note 与可独立调度的 Card 分开，使一份内容产生多个提问角度而不复制事实。
2. sibling 是调度层的一等关系；反向卡、多个 cloze 或 image occlusion 不应在同一 session 互相泄露答案。
3. review history 应独立保留，不能只保存当前 due date；优化、迁移、冲突合并和解释都依赖历史。

风险：

1. Note Type、Field、Card Type、Deck、Preset 和 Scheduler 的组合非常灵活，也会把配置复杂度暴露给用户。
2. schema/template 变更会进入同步冲突面；如果 Memorilo 的卡片直接依赖可持续编辑的 block tree，需要从一开始定义内容变更如何影响 card identity 和 history。
3. Scheduler 的评分含义属于数据契约。不同 UI 文案若改变 `Hard`/`Again` 的使用方式，会直接降低算法质量。

## 2. RemNote

### 2.1 内容与学习模型

RemNote 本质上是 outline：document 由可缩进为 parent/child hierarchy 的 bullets 构成；Knowledge Base 是所有顶层 bullet hierarchies 的集合。Document 和 Folder 也不是独立内容对象，而是选择以不同方式显示的普通 bullet，任意层级 bullet 都能转为 Document。[RemNote Help: Outlines and Terminology](https://help.remnote.com/en/articles/8196578-outlines-and-terminology)；[Documents and Folders](https://help.remnote.com/en/articles/6030703-documents-and-folders)

任意 bullet 可直接生成 flashcard。Basic card 将 prompt 和 answer 写在笔记本身，用 `==` 或 `>>` 分隔；还支持反向/双向、Concept、Descriptor、Cloze、Multiple Choice、Multi-Line、Image Occlusion 和表格生成。Card 与源 bullet 关联，而不是另一份需要手动同步的文本。[RemNote Help: Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)

复习卡片默认带上源 bullet 的 ancestors 作为 context。这把 outline 层级直接纳入 card presentation，也意味着移动或重组知识节点可能改变问题上下文。[RemNote Help: Creating Flashcards - Context](https://help.remnote.com/en/articles/6025481-creating-flashcards)

### 2.2 调度与用户控制

RemNote 默认 scheduler 是其实现的 Anki SM-2：Card 先经过固定 steps 的 Learning Phase，再进入基于 interval 和 ease 的 Exponential Phase，忘记后进入 Relearning Phase。默认 Starting Ease 为 230%，ease 下限为 130%；评分、当前 ease、late-review bonus、interval multiplier 和少量随机噪声共同决定下次间隔。[RemNote Help: The Anki SM-2 Spaced Repetition Algorithm](https://help.remnote.com/en/articles/6026144-the-anki-sm-2-spaced-repetition-algorithm)

RemNote 也集成 FSRS v6。官方页面在访问时仍把它标为 beta；可全局启用，也可创建 custom scheduler 分配给部分 documents/folders。FSRS weights 可从 review history 自动训练，官方建议至少累积 1,000 次 reviews 后再训练。[RemNote Help: The FSRS Spaced Repetition Algorithm](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm)

Custom Scheduler 沿 bullet ancestry 继承：系统先检查 card 的源 bullet，再逐级检查 parent，直至找到 scheduler，否则使用 Global Default Scheduler。这使知识层级同时成为调度政策的作用域。[RemNote Help: Custom Schedulers](https://help.remnote.com/en/articles/6958056-custom-schedulers)

Exam Scheduler 不是另一套主算法，而是在 Anki SM-2 或 FSRS 之上，围绕指定考试日期临时增加复习或改变 desired retention。其目标是提高某个时间点的表现，而不是长期单位时间记忆量。[RemNote Help: Understanding the Exam Scheduler](https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler)

### 2.3 复习流程

用户可以进入全局 queue，也可只练习某个 Document。正常流程是先看正面并主动回忆，显示答案后选择：

- `Forgot`；
- `Partially recalled`；
- `Recalled with effort`；
- `Easily recalled`；
- `Skip`：不记录评分，一小时后再出现。

按钮同样显示预计下次出现时间。[RemNote Help: Getting Started with Spaced Repetition](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition)

RemNote 不提供“暂停整个时间”的 scheduler：官方解释，暂停 due dates 会让系统的记忆模型脱离现实。它提供 daily learning goal、stale card 分批重新引入，以及按文档 priority 设为 Paused/Maintaining 等过载处理手段。[RemNote Help: Can I Pause the Flashcards Scheduler?](https://help.remnote.com/en/articles/7967414-can-i-pause-the-flashcards-scheduler)

### 2.4 知识链接与阅读加工

References 是指向另一个 bullet 的链接并产生 backlink；Tags 表达当前 bullet 是另一 bullet 的一个类别；Portals 在其他层级中显示同一个 bullet 及可选 descendants，所有位置编辑的是同一份内容。[RemNote Help: References, Tags, and Portals](https://help.remnote.com/en/articles/6634227-what-s-the-difference-between-references-tags-and-portals)

Reader 将 PDF、其他文件和网页与 Notes pane 并列：用户可 highlight、把 source reference 粘到笔记、创建卡片或 image occlusion，并从笔记跳回原文位置。Web Reader 保存网页 snapshot，因此原网页下线后仍可阅读；刷新 snapshot 前需要移除已有 highlights。[RemNote Help: Learning from PDFs and Files](https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader)；[Learning from Web Pages](https://help.remnote.com/en/articles/7910548-learning-from-web-pages-in-the-remnote-reader)

这些是强“阅读 -> 引用 -> 笔记 -> 卡片”闭环，但官方资料没有描述像 SuperMemo 那样将未读文章片段本身放入递增间隔和 priority queue。因而它不应被直接等同于完整 incremental reading。

### 2.5 同步与可携带性

Desktop/mobile 可离线编辑与复习，重新联网后会同步修改和 review progress；官方还声称多设备离线编辑会在下一次同步自动合并。Desktop 保存 Knowledge Base 中图片和 PDF 的完整本地副本，mobile/web 只缓存部分媒体。[RemNote Help: Offline Mode](https://help.remnote.com/en/articles/6752029-offline-mode)

导出支持 RemNote Complete、OPML、Anki `.apkg`、HTML、Markdown 和 Text。Complete 是可无损导回 RemNote 的原生内容格式，但当前不包含图片或 PDF；Anki 导出只包含 flashcards，并会带上 parent hierarchy 以保留 context。[RemNote Help: Exporting Notes](https://help.remnote.com/en/articles/7898019-exporting-notes)

Desktop 会生成本地 `.db.zip` backups；Synced Knowledge Base 另有云端 daily backups。官方警告，manual Complete backup 不含 uploaded files、设置、KB name、themes 或 plugins。[RemNote Help: RemNote Backups](https://help.remnote.com/en/articles/6301627-remnote-backups)

### 2.6 对 Memorilo 的判断

值得学习：

1. Card generation 是 editor 中的原生表达，不要求用户进入另一套“制卡数据库”。
2. 稳定 block identity 让 source references、backlinks、transclusion 和 card source 共用一套关系。
3. Scheduler policy 沿知识树继承，比要求每张 Card 单独配置更适合 outline 产品。
4. Reader 保留 source location，使复习时发现歧义后能回到证据并修订源笔记。

风险：

1. 一个节点同时承载 hierarchy、reference、portal visibility、priority 和 scheduler inheritance，容易使“为什么这张 Card 此时出现/不出现”难以解释。
2. 祖先内容会进入 Card context，因此 reparent、portal、collapse 等结构操作是否改变 card presentation 和 queue membership 必须有清晰规则。
3. 原生备份不含媒体说明“结构可导出”不等于“知识库可完整迁移”。Memorilo 的出口格式需把 blocks、assets、card definitions 和 review history 作为一个可验证整体。

## 3. SuperMemo 17

### 3.1 Element、Topic、Item 与知识树

SuperMemo Collection 由 Elements 构成，Knowledge Tree 是 Elements 的 hierarchy。Tree 中的 Element 可以是：用于主动回忆的 question-answer Item、用于阅读/观看的 Topic、Concept 或 Task；任一 Element 也可包含 text、picture、sound 等 components。[SuperMemo 17 Help: Building the Knowledge Tree](https://www.super-memory.com/help/tree.htm)

官方强调 Tree structure 本身不影响调度。它用于整理 collection、按 branch review 或调整某个 subject；知识的心智联系来自元素之间的语义关系，而不只是文件夹层级。Concept Groups 可为某一 branch 统一 insertion point、template 和默认 priority；SuperMemo 17 另有 concept maps 和 spreading activation 的 neural review。[SuperMemo 17 Help: Building the Knowledge Tree](https://www.super-memory.com/help/tree.htm)；[Features](https://www.super-memory.com/help/features.htm)

### 3.2 Incremental Reading

SuperMemo 对 incremental reading 的官方流程是：

```text
导入 article（Topic）
  -> 每次阅读一小部分，保留 read-point
  -> 抽取重要段落为独立的 mini-article / Topic
  -> 继续缩短、补足 context、传播 source reference
  -> 生成 cloze 或普通 Q&A Item
  -> 主动回忆与间隔复习
```

用户在一个 article 读一小段后切换到另一个；低价值或难以理解的文章可进入更长 review interval，重要 extract 可设置更高 priority 或更短 interval。系统将新文章阅读与已有 Items 的复习混在同一个 learning flow 中。[SuperMemo 17 Help: What is Incremental Reading?](https://www.super-memory.com/help/read.htm#What_is_incremental_reading.3F)；[Reading Articles](https://www.super-memory.com/help/read.htm#Skill_2:_Reading_articles)

Extract 会成为独立的 Topic，references 沿 extracts 和 cloze deletions 传播。官方认为被动 rereading 在间隔增长到数百天后不足以保证 recall，因此把 Topic 转成 Cloze Item，实现从 passive review 到 active recall。[SuperMemo 17 Help: Extracting and Cloze](https://www.super-memory.com/help/read.htm#Skill_3:_Extracting_fragments.2C_questions_and_answers)

Topics 和 Items 的调度类似但不相同。Item 间隔由复杂算法控制，限制手工介入以保护 retention；Topic 的 inter-review interval 更简单且主要由用户决定。Priority、auto-sort 和 auto-postpone 用于在输入量超过处理能力时优先保护高价值内容。[SuperMemo 17 Help: Repetition and Review](https://www.super-memory.com/help/read.htm#Skill_4:_Repetition_and_review)；[Features](https://www.super-memory.com/help/features.htm)

### 3.3 SM-17 与用户控制

SM-17 以 Difficulty、Stability、Retrievability（DSR）描述记忆状态。Stability 表示记忆在不被提取时能维持多久；Retrievability 表示某一时刻成功提取的概率；Difficulty 由完整 repetition history 的成绩拟合。新间隔由当前 stability、DSR 对应的 stability increase 和 requested forgetting index 共同决定。[SuperMemo 17 Help: SuperMemo Algorithm](https://www.super-memory.com/help/smalg.htm)

与只基于最近 interval 的简单算法不同，SM-17 官方说明其 optimum interval 使用完整 repetition history；它还把 delay、提前复习和 lapse 时的 retrievability 纳入估计。代价是必须保存每个 Item 的完整 review history，且算法具有显著实现和解释复杂度。[SuperMemo 17 Help: Strengths and Weaknesses of SM-17](https://www.super-memory.com/help/smalg.htm#Past_vs._Future)

SuperMemo 提供 requested forgetting index 作为 retention/workload 控制，还提供 Advance、Postpone、Spread、priority、topic interval 等过载或考试前调整工具。[SuperMemo 17 Help: Features](https://www.super-memory.com/help/features.htm)

### 3.4 复习流程

经典 repetition cycle 是：看 Question、主动回答、Show Answer、比较答案，然后选择六级成绩：

- `Great (5)`；
- `Good (4)`；
- `Pass (3)`；
- `Fail (2)`；
- `Bad (1)`；
- `Null (0)`。

关键二元边界是 Pass 及以上代表 remembering，Fail 及以下代表 forgetting。被动 Topic review 可直接进入 Next repetition，不经过问答评分。[SuperMemo 17 Help: Learn](https://www.super-memory.com/help/learn.htm)

### 3.4.1 学习期间并非只读：允许即时编辑

SuperMemo 的学习流程把“回忆/评分”和“知识加工”放在同一工作流中，并不是把到期内容锁定为只读卡片。Incremental Reading 的官方步骤要求点击文章进入 **editing mode**，可直接修改正文、选择片段、删除已处理内容、添加上下文和设置 read-point；完成当前片段后再用 `Learn`/`Next repetition` 切换到下一篇文章。[SuperMemo 17 Help: Reading articles](https://www.super-memory.com/help/read.htm#Skill_2:_Reading_articles)

到期 Item 的复习也允许即时修订。官方“Re-evaluation of items”建议在每次 repetition 评估题目是否需要改写，并把 `edit the item` 列为典型动作，可进入 Question/Answer 字段或组件 editing mode，随后再继续评分和下一次 repetition。[SuperMemo 17 Help: Re-evaluation of items](https://www.super-memory.com/help/read.htm#Re-evaluation_of_items)

这意味着 SuperMemo 的“学习”至少有两种交织状态：

1. **主动回忆**：Question → 尝试回答 → Show answer → 选择 Grade → Next repetition；
2. **增量加工**：在 Topic/Item 到期时阅读、抽取、改写、补充上下文或生成 Cloze，然后再决定下次时间/优先级。

因此，若将 SuperMemo 作为产品参照，“学习页是否允许编辑”不能只按复习卡片的只读/可写二元划分：Topic 阅读和 Item 复评都支持在当前学习上下文中修订内容，但问答评分仍是独立的记忆事件。这个边界与 Memorilo 当前正式 Review UI 使用只读 `CardSurface` 的实现不同；不能把后者的限制归因于 SuperMemo 的通用学习范式。

### 3.5 本地数据与可携带性

经典 Collection 是一个 `.kno` 文件和同名 companion folder 的组合，完整 backup 必须同时保存二者。官方提供 Copy Collection、带日期的 Backup，以及恢复流程，并反复警告只复制 `.kno` 会得到不可用备份。[SuperMemo 17 Help: Backup](https://www.super-memory.com/help/backup.htm)

可携带格式包括 Q&A text、XML、HTML、collection source code、learning process 和 repetition history。XML 可携带 knowledge tree 和可选 learning process；HTML 只导出 text/image components；单独的 learning-process backup 不保存用户对文本的编辑。[SuperMemo 17 Help: File Menu - Import and Export](https://www.super-memory.com/help/file.htm#Import)

这些资料说明的是本地复制、备份和导入导出流程，不是云同步协议。由于新版经典产品 Wiki 未能访问，本文不进一步断言当前 SuperMemo 18/19 是否提供其他同步能力。

### 3.6 对 Memorilo 的判断

值得学习：

1. “待理解的来源”也可以有 `nextReviewAt + priority + readPoint`，不必等它变成 Card 后才进入学习系统。
2. Topic -> Extract -> Item 是渐进精炼链，产物保留 provenance，而不是一次性从全文批量生成孤立卡片。
3. 队列过载是核心领域问题。Priority、auto-postpone 和分层 review 比单纯“今日到期数量”更能处理无限输入。
4. 被动加工和主动回忆需要不同的状态机和调度政策，不应把 article chunk 假装成普通 Card。

风险：

1. SuperMemo 官方自己描述 incremental learning 的学习曲线陡，需要长期掌握操作；还列出 opportunity cost、overhead、低质量输入和挫败等缺点。[SuperMemo 17 Help: Disadvantages](https://www.super-memory.com/help/read.htm#Disadvantages)
2. Topic、Item、Priority、Interval、Concept、Tree、Read-point 和多种 queue 同时出现，会显著增加导航和解释成本。
3. `.kno + folder` 的脆弱备份边界表明：一旦阅读来源、extract、asset 和 review history 形成引用链，必须提供原子、可验证且媒体完整的迁移格式。
4. SM-17 的完整历史和个体拟合是长期能力，不适合作为首次制卡功能的前置条件。

## 4. AnkiConnect：外部 Anki 调度与原生调度的边界

这一节对应 Memorilo issue [#29](https://github.com/memorilo/memorilo/issues/29) 中“先通过 AnkiConnect 同步，再评估原生 FSRS”的方向。

### 4.1 AnkiConnect 的实际契约

AnkiConnect 是运行在 Anki 内的 add-on。它在 Anki 启动时于 `127.0.0.1:8765` 暴露 HTTP JSON API；默认 API authentication 是关闭的，可在 config 中设置 API key。外部应用要使用它，Anki 必须保持运行。macOS 文档还特别指出 App Nap 可能在 Anki 不可见时暂停它。[AnkiConnect README: Installation and Application Interface](https://git.sr.ht/~foosoft/anki-connect/tree/de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e/item/README.md#L5)

API request 由 `action`、`version`、`params` 和可选 `key` 构成，response 是 `result/error`。这是一套本机命令 API，不是持续复制两套数据库的 sync protocol。[AnkiConnect README: Sample Invocation](https://git.sr.ht/~foosoft/anki-connect/tree/de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e/item/README.md#L38)

关键操作包括：

- `addNote(s)`：在 Anki 中创建 Note，由 Anki Note Type 生成 Cards；
- `findCards` / `cardsInfo`：按 Anki query 获取 Card ids、正反面、Note、Deck、ease、interval 等；
- `answerCards`：提交 Card id 和 ease `1..4`；
- `sync`：触发 Anki 自己配置的 collection/media sync。

[AnkiConnect README: Supported Actions](https://git.sr.ht/~foosoft/anki-connect/tree/de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e/item/README.md#L161)

源码中的 `answerCards` 直接取得 Anki `collection().sched` 并调用 `scheduler.answerCard(card, ease)`；因此回答后的 state、history、interval 和 due date 是 Anki scheduler 的产物，不由调用方计算。[AnkiConnect source: `answerCards`](https://git.sr.ht/~foosoft/anki-connect/tree/de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e/item/plugin/__init__.py#L1620)

### 4.2 两种所有权方案

| 决策面 | AnkiConnect / 外部 Anki 所有调度 | Memorilo 原生所有调度 |
| --- | --- | --- |
| Content source | Memorilo block 与 Anki Note 形成映射；需定义单向或双向编辑权 | Memorilo block 是唯一内容真源 |
| Card identity | 必须持久化 Anki note/card ids，并处理模板重建、删除和重新导入 | 使用稳定 block/card definition id，可在本地事务内维护 |
| Review history | Anki collection 所有；Memorilo 只能查询或缓存 | Memorilo schema 所有，并参与自己的 sync/backup |
| Scheduling | Anki 的 FSRS/SM-2、steps、presets、burying 和 limits | 需要实现或集成算法，同时实现完整 card state machine 与 queue policy |
| Runtime | 依赖 Anki Desktop + add-on 正在运行；API 为 localhost | Memorilo 单应用可离线运行 |
| Cross-device | 由 AnkiWeb/Anki 客户端同步；Memorilo 还需同步 block-to-card mapping | 与 Memorilo CRDT/SQLite 生命周期统一，但需解决 review conflicts |
| Portability | 可利用 `.apkg/.colpkg` 和 Anki 生态 | 必须自行定义完整、版本化、含媒体和 history 的出口 |
| 近期成本 | 低，可快速验证 Card UX 和内容生成 | 高，算法只是其中一部分，状态机、迁移、统计和合并同样必要 |

### 4.3 AnkiConnect 历史路线需要先决定的问题

1. **谁是 Card presentation 的真源？** 若 Anki template 生成最终 front/back，Memorilo editor 预览必须容忍差异；若 Memorilo 生成最终 HTML，则要定义哪些 Anki edits 会被覆盖。
2. **编辑同步方向是什么？** “Memorilo -> Anki 发布”比双向同步简单得多；双向会遇到 Note schema、template、media、删除和冲突合并。
3. **复习发生在哪里？** 若在 Memorilo UI 中复习，必须通过 `answerCards` 将每次评分提交给 Anki，不能在 Memorilo 单独推进 due date，否则会产生两套历史。
4. **Anki 不可用时如何降级？** 可明确为只编辑不复习、排队等待提交，或完全禁用入口；不能假设本机 HTTP 服务总在。
5. **如何发现外部变更？** AnkiConnect 提供查询 API，但不是 change feed；需要设计显式刷新、版本/修改时间比较和删除检测。
6. **如何退出集成？** 即使第一版不做原生 scheduler，也应让 Memorilo 的 card definition 与 Anki ids 分离，保留将来迁移 content 和 history 的边界。

调研当时的产品判断是：issue #29 的 AnkiConnect 方向适合作为**有明确依赖的第一阶段 integration**，但不宜称作“Anki 双向同步”，除非范围包含冲突、删除、模板和媒体的完整语义。最小可靠范围更接近“Memorilo 发布/更新 Notes 到 Anki，读取 Card 状态，并把 review rating 提交给 Anki scheduler”。项目后续没有采用这条路线，当前 scheduling owner 是 Memorilo 原生 FSRS。

## 5. Memorilo 当前基础与约束

以下是结合当前仓库得到的规划判断，不是原产品事实。

### 5.1 已有能力

- 每个 Memorilo `Note` 是一个 LoroDoc 聚合；Folder、Topic 和 Topic 内容处于同一可协作、可持久化、可 time travel 的历史中。[ADR 0001](../adr/0001-note-as-loro-aggregate.md)
- 每个 Topic 的内容是具有稳定 Block identity 的 LoroTree；ProseMirror 是它的可编辑 projection。[ADR 0002](../adr/0002-topic-blocks-as-loro-tree.md)
- `packages/editor` 已能把 Topic 投影为带稳定 `blockId`、parent、ordinal、kind、text 和 attributes 的 Block 列表。
- `packages/editor-storage` 已把 Block projection 写入 SQLite，并提供 lexical、semantic 和 hybrid search；这使未来从 Card 返回来源 Block、查找相关上下文和构建学习 scope 都有现成落点。
- `packages/editor` 已实现 CardTopic lifecycle：每个 Basic/List/Set Definition、ClozeGroup、连续 inline Highlight 和 block Highlight 生成 child Topic，并支持 synced、detached、resync 与嵌套。
- 桌面端已经具有 Learning Notes、Optimizer 设置和独立 Review 路由；Electron IPC/preload 公开学习契约，`packages/editor-storage` 保存 Review Events 与 Learning States，`packages/srs` 负责 FSRS、队列政策和 List/Set 两层调度。

### 5.2 必须保持的边界

1. Memorilo 已经把 `Note` 定义为协作聚合、把 `Topic` 定义为可编辑内容节点。因此不应照搬 Anki 的 Note 术语或 SuperMemo 的 Topic 术语，否则会产生同名异义。
2. Card 内容定义应随 Note 协作、移动和 time travel；个人 review history、due state 和 scheduler parameters 不应直接写入 Note LoroDoc。否则每次评分都会制造内容协作更新，并把个人学习状态混入共享知识。
3. Regular Topic 本身不进入队列。其 `due`、`learned` 等状态只能是 child CardTopics 所拥有 Cards 的聚合 projection，不能成为持久化真源。
4. 当前 Block `contentHash` 只覆盖纯文本。Cloze anchor、方向、答案边界、ListCard membership 与 Highlight 等语义变化需要独立的内容语义 projection/hash，不能依赖现有搜索索引判断 Card 是否变化。
5. Card identity 不能由当前 ordinal 或 cloze 的临时位置推导。移动 Block、改写文字或在前面插入另一个 cloze 时，已有 review history 必须仍关联到原 Card。

## 6. Memorilo 当前领域模型

```text
Regular Topic / Source Block（Loro，authoring 真源）
  -> Card Definition / Highlight source
     -> CardTopic child（synced 或 detached 的学习内容 owner）
        -> Card（一个可独立调度的提问实例）
           -> Review Events（个人、追加式历史）
              -> Memory State（可重建的调度状态）
                 -> Review Queue（按当前 scope 动态查询）
```

当前实现采用以下术语；Reading Item 仍是未来边界：

| 术语 | 含义 | 真源位置 |
| --- | --- | --- |
| Source Block | 承载知识内容的稳定 Block | Note LoroDoc |
| Card Definition | Basic、Reverse、Bidirectional、RichContentCloze、MathSourceCloze、ListCard 等出题规则 | Note LoroDoc 的语义节点、属性或 mark |
| CardTopic | 从一个 Definition、ClozeGroup 或 Highlight 区域创建的 child RegularTopic；是 Preview 与 Learning 的内容 owner | Note LoroDoc；`cardSource` 记录来源和 sync status |
| Card | CardTopic 拥有的一个方向、一个 cloze group、一个 Highlight 或一个遮挡区产生的独立复习单位 | 从 CardTopic 文档投影；具有显式稳定 ID |
| Sibling Group | 同一 Note 中共享 `sourceBlockId`、可能互相泄露答案的一组 Cards，包括嵌套 CardTopics | Card projection |
| Review Event | 某 profile 在某时刻以某 rating 回答 Card 的事实 | SQLite 中的追加式历史与本地 sync outbox；远端同步尚未实现 |
| Memory State | New/Learning/Review/Relearning、stability、difficulty、due 等 | Review Events 的可重建 SQLite 物化结果 |
| Review Queue | due/new/relearning Cards 在某一 scope 下的排序结果 | 动态计算，不作为内容实体持久化 |
| Reading Item | 未来渐进阅读中的来源、read point、priority 与 next process time | 独立于 Card 的后续领域对象 |

关键不变量：

- 普通内容编辑默认保留 Card ID 和 review history；用户明确选择“重置学习”时才清空或重建 Memory State。
- 删除来源 Card Definition 时保留并 detached 对应 CardTopic，因此 Card 继续 active；只有 CardTopic 自身被删除或 owned identity 消失时才停用 Card，且不级联删除 review history。
- 历史 checkout 状态下不允许提交 review，避免用旧内容推进当前 scheduler。
- 同一 Card 在任一时刻只有一个 scheduling owner：Anki 或 Memorilo，不能双方分别计算 due date。
- Rating 的语义属于 scheduler 契约。UI 文案、键盘快捷键和导入映射必须固定且可解释。

## 7. 当前模块边界

| 模块 | 职责 |
| --- | --- |
| `packages/editor` | Card Definition 的编辑语义、稳定 ID、CardTopic lifecycle、两类 Cloze anchor、ListCard reveal projection、inline/whole-block Highlight，以及 owned Card projection |
| `packages/srs` | Rating、FSRS state transition、Optimizer、queue policy、sibling policy 与 multi-line 调度；不依赖 Electron 或 SQLite |
| `packages/editor-storage` | Card projections、review events、materialized memory state、动态队列查询、Optimizer、事务、本地 sync outbox 与数据库维护 |
| `apps/desktop/main` | 组合 Note/CardTopic reconciliation、editor-storage、当前配置 provider 与 learning application，暴露 IPC service |
| `apps/desktop/preload` | context-isolated queue、review preparation/rating、Undo/Reset、Optimizer 与维护 contracts |
| `apps/desktop/renderer` | Learning Notes、Optimizer 和 Review routes，CardSurface 展示、session 状态与路由恢复 |

这条边界把“如何出题”“如何安排下一次复习”“数据存在哪里”“界面如何呈现”分开，使 editor 文档模型不依赖具体 scheduler 或未来互操作适配器。

当前 Review history 已采用不可变事件加物化状态，而不是只存一行 due date；撤销通过追加 Undo Event 表达。这样保留了解释、重新计算和参数升级能力，也更贴合 issue [#32](https://github.com/memorilo/memorilo/issues/32) 中非 CRDT 数据需要独立同步的边界。本地 outbox 与 server-sequence acknowledgement 已实现；远端传输、入站合并和多设备并发 review 协调仍需在真正实现 P2P 前完成。

## 8. 调度所有权决策（已解决）

Issue [#29](https://github.com/memorilo/memorilo/issues/29) 曾提议先通过 AnkiConnect 获得调度能力。项目最终选择原生 FSRS 作为唯一 scheduling owner；下表保留调研时比较过的路线，而不是当前仍待选择的方案。

| 路线 | 适用目标 | 优点 | 主要代价 |
| --- | --- | --- | --- |
| 原生 FSRS | Memorilo 要成为可独立使用的学习产品 | 完整离线；内容、复习、备份与未来 P2P 边界一致；无需 Anki 常驻 | 需要自行实现 state machine、queue、history、迁移和冲突政策 |
| AnkiConnect | 先验证制卡和复习交互，接受 Anki 作为运行时依赖 | 较快获得成熟 scheduler、AnkiWeb 与生态能力 | Anki 必须运行；需维护 external IDs；无 change feed；退出和双向编辑复杂 |
| 只做 Editor Card 层 | 先验证全部首期元素与 Preview projection | 不触碰 Desktop、存储或 scheduler；通过自动化测试收敛复杂交互 | 暂时没有正式复习队列与跨会话学习状态 |

当前决策是**原生 FSRS**。实现使用独立 `packages/srs` 深模块承载可测试的调度规则，并由 `packages/editor-storage` 保存追加式 Review Events、物化状态和 Optimizer revisions。AnkiConnect 若未来加入，只能作为明确的互操作功能，不能同时推进同一 Card 的本地调度状态。

无论选择哪条路线，都不应让 Anki 和 Memorilo 同时接受同一 Card 的 rating，也不应以“先缓存 due date”代替明确的 scheduling ownership。

## 9. 分阶段实施记录

截至 2026-08-16，阶段 0、1A、1B 与原生复习闭环的核心部分已经完成；CardTopic ownership、半同步/解除同步、嵌套、Highlight Card、独立 Learning/Review UI、四级评分、interval preview 和 Undo 已完成。AnkiConnect 路线未采用，远端个人学习同步、完整 source navigation/suspend 操作和渐进阅读仍属于后续工作。以下条目保留原始实施拆分，并在已过时处标注当前结果。

### 阶段 0：冻结领域决策

- 该历史阶段只修改 `packages/editor`，不触碰 Desktop、SQLite、IPC 或正式 scheduler；后续已经选择原生 FSRS，并进入持久化与桌面集成。
- 首期 Card authoring 包含 Basic、Reverse、Bidirectional、RichContentCloze、MathSourceCloze 与 ListCard。该阶段曾把 Highlight 视为纯格式；当前设计已由 ADR 0006 改为每个 Highlight 来源生成无背面的 CardTopic/Card。
- 确定普通内容编辑、实质性改写、删除、Undo 和“重置学习”对 Card identity/history 的语义。
- 记录 ADR：协作 Card Definition 与个人 Review State 分离。

### 阶段 1A：Editor-only Card 层

- 在 `packages/editor` 中使用内存文档、稳定身份和浏览器测试验证 Card 行为，不 import Desktop，也不连接 persistence 或 scheduler。
- 加入语义化的 Basic、Reverse、Bidirectional、RichContentCloze、MathSourceCloze 与 ListCard 表达；快捷语法只负责创建语义结构，不把原始分隔符当作长期数据模型。
- 为每个 Card 和 sibling group 写入显式稳定 ID。
- 自动验证 Editor authoring、Preview Front 与 Preview Back；ListCard Preview 按顺序逐项揭示，session 内只保存 reveal index。
- 同时实现 inline Highlight 与 whole-block Highlight，并在 authoring editor 中保留样式；后续 CardTopic 模型让它们各自生成无背面的 Highlight Card。
- RichContentCloze 允许选区包含完整 inline 元素或整个公式；MathSourceCloze 只处理 LaTeX source 内部局部内容。
- 同一 ClozeGroup 可以混合 RichContentAnchor 与 MathSourceAnchor；Preview 将两类片段作为同一张 Card 同步隐藏和揭示。
- 第一阶段不加入 Image Occlusion；它依赖 issue [#28](https://github.com/memorilo/memorilo/issues/28) 的 PDF/asset annotation、稳定区域坐标和 provenance 模型。

当时的阶段完成标志是六类 Card authoring/Preview 与两类 Highlight 都能在 editor-only 环境交互验证，且移动或编辑 Source Block 不会意外生成新 Card。此后 Desktop、SQLite 和正式 scheduler 已接入 CardTopic-owned projection；Editor-only 边界只用于说明该历史里程碑。

> **已完成（2026-08-06）**：List/Set 已具有稳定 main/item Targets、逐项评分历史、Partial Review 和正式 FSRS 调度；完整 multi-line 评分以原子事务提交。

### 阶段 1B：持久化投影

- 从 CardTopic 文档投影 Card front/back、source Block、context、类型和 active state；无 `cardSource` 的 regular Topic 不再直接投影学习 Card。
- 在 SQLite 保存可重建的 Card projection，并以 CardTopic `topicId` 返回 Note/Topic/Block 内容来源。
- CardTopic ownership 与 List/Set 两层 Target 模型随主数据库当前的 Drizzle migration generation 运行；learning schema generation 独立维护。

### 阶段 2A：原生复习闭环（已采用）

- 已实现 Optimizer configuration/revision、Review Event 和 materialized Learning State schema。
- 已接入 FSRS，并把 new/learning/relearning/review state machine、learning steps、queue ordering、daily new-card limit、fuzz 和 Sibling Bury 作为独立领域政策。
- 已提供 interval preview、submit rating、Undo 和 Reset storage contract；自动 Sibling Bury 已进入队列，手动 bury/suspend 与 Reset 的 Review UI 尚未实现。
- 已保存 FSRS/parameter version，为重放和参数升级提供依据。

应用重启后的 due queue、history 和下一间隔保持一致，Sibling Bury 也已进入 E2E 闭环。

### 阶段 2B：AnkiConnect 验证闭环（未采用）

以下是调研阶段保留的备选路线，没有进入当前实现：

- 只做 Memorilo -> Anki 的发布/更新，并持久化 external note/card IDs 与 last-synced definition hash。
- Review UI 的 queue、front/back、interval preview 和 rating 都读取或提交给 Anki；Anki 不可用时明确禁用 review，而不是本地推进状态后延迟合并。
- 不做双向 template/schema 编辑；外部删除和修改通过显式 refresh/reconcile 处理。
- 从第一天定义退出策略：如何解除 binding、重新发布、导出以及将来迁移 review history。

阶段完成标志：重复发布幂等；Anki 中模板变化、Card 删除和服务不可用都有可解释结果；Memorilo 不保存第二套 scheduler state。

### 阶段 3：Learn UI 与聚合状态（部分完成）

- 已实现独立 Learning/Review route 和 session，而不是把完整复习流程塞进 Note inspector。
- 已实现只读 CardSurface、answer reveal、四级 Rating、interval preview、Undo、键盘评分、route restoration，以及 Basic/List/Set/Cloze/Highlight CardTopic 的正式 Review 交互。Highlight 无背面并直接评分。
- 当前 queue scope 支持全局和当前 Note；当前 CardID 进入 route search 以恢复进度。Topic/tag scope 尚未开放。
- 稳定 Source Block 跳转、edit source、手动 bury/suspend/reset 控件，以及完整 inspector 聚合状态仍未实现。

### 阶段 4：互操作、备份与同步准备（部分完成）

- Optimizer parameter optimization、retention/configuration 调整与可选立即重调度已经实现。
- Review Events、device sequence、本地 sync outbox、server-sequence acknowledgement 和 purge tombstone 已形成同步基础，但没有远端 transport、入站 merge 或 full-sync recovery。
- 包含 Note content、assets、Card Definitions、Review Events 和 scheduler configuration 的版本化出口，以及 Anki import/export，仍未实现。
- P2P 的 profile identity、event ordering、重复 Rating 和并发 review conflict policy 仍需要与实际远端协议一起落地；Memory State 已按可重建缓存实现。

### 阶段 5：渐进阅读

SuperMemo 式 incremental reading 应作为 Card 系统之上的独立能力：

```text
Reading Item
  = source + readPoint + priority + nextProcessAt + provenance

Review Card
  = prompt + answer + rating history + scheduler state
```

- Reader/PDF/Web source 先生成可定位 excerpt，再由用户逐步改写为 Source Block 和 Card Definition。
- Reading queue 与 Card due queue 可在一个 Learn session 交错呈现，但 action、完成条件和调度政策分离。
- Priority 用于处理输入过载，不应覆盖 FSRS due date；原始 inspector 原型中的 `Priority` 在实现前需要明确它属于 Reading Item、Card introduction，还是 Topic 聚合。

## 10. 当前状态与后续边界

当前已经形成“regular Topic authoring -> child CardTopic -> 动态队列 -> 正式复习 -> FSRS 状态持久化”的闭环：Editor 支持 Basic/Reverse/Bidirectional、两条 Cloze 路径、List/Set、inline/block Highlight、稳定 Card identity、synced/detached 与嵌套；Desktop 支持 CardTopic Preview、全局/Note Review、四级评分、main/item 两层调度、Sibling Bury、每日新卡额度、Daily Goal、Optimizer assignment/optimization 和跨重启恢复。

当前 CardTopic、learning schema 和 List/Set 两层 Target 模型运行在主数据库当前的 Drizzle migration baseline 上；learning schema generation 独立维护。

仍未完成的主要边界是远端个人学习同步、完整的 source navigation 与 suspend 等 Review 操作、版本化导入导出，以及 SuperMemo 式渐进阅读；这些不影响当前原生 FSRS 闭环。

## 官方资料

### Anki

- [Anki Manual: Getting Started](https://docs.ankiweb.net/getting-started.html)
- [Anki Manual: Studying](https://docs.ankiweb.net/studying.html)
- [Anki Manual: Deck Options and FSRS](https://docs.ankiweb.net/deck-options.html)
- [Anki Manual: Syncing](https://docs.ankiweb.net/syncing.html)
- [Anki Manual: Exporting](https://docs.ankiweb.net/exporting.html)
- [AnkiConnect official repository and API documentation](https://git.sr.ht/~foosoft/anki-connect)

### RemNote

- [Outlines and Terminology](https://help.remnote.com/en/articles/8196578-outlines-and-terminology)
- [Documents and Folders](https://help.remnote.com/en/articles/6030703-documents-and-folders)
- [Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
- [Getting Started with Spaced Repetition](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition)
- [The Anki SM-2 Spaced Repetition Algorithm](https://help.remnote.com/en/articles/6026144-the-anki-sm-2-spaced-repetition-algorithm)
- [The FSRS Spaced Repetition Algorithm](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm)
- [Custom Schedulers](https://help.remnote.com/en/articles/6958056-custom-schedulers)
- [Understanding the Exam Scheduler](https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler)
- [References, Tags, and Portals](https://help.remnote.com/en/articles/6634227-what-s-the-difference-between-references-tags-and-portals)
- [Learning from PDFs and Files with the RemNote Reader](https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader)
- [Offline Mode](https://help.remnote.com/en/articles/6752029-offline-mode)
- [Exporting Notes](https://help.remnote.com/en/articles/7898019-exporting-notes)
- [RemNote Backups](https://help.remnote.com/en/articles/6301627-remnote-backups)

### SuperMemo 17

- [SuperMemo Algorithm (SM-17)](https://www.super-memory.com/help/smalg.htm)
- [Incremental Reading](https://www.super-memory.com/help/read.htm)
- [Learn and Grades](https://www.super-memory.com/help/learn.htm)
- [Building the Knowledge Tree](https://www.super-memory.com/help/tree.htm)
- [SuperMemo 17 Features](https://www.super-memory.com/help/features.htm)
- [Backup](https://www.super-memory.com/help/backup.htm)
- [File Menu: Import and Export](https://www.super-memory.com/help/file.htm)
