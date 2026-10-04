# Note 导出资源内联与资产处理调研

调研日期：2026-09-04

## 结论

HTML/PDF 导出应把图片解析为“可携带资源”而不是把工作区路径写入文件：受管 `memorilo://asset/<uuid>.<ext>` 先在主进程读取并转换为 `data:<mime>;base64,...`，普通 `http(s)` 资源则在显式策略下下载或保留原 URL，并始终附带诊断。导出代码不应直接访问 `assetDirectory`，也不应依赖应用脚本、IPC 或 `/reader` 路由。

资源读取失败不能变成空白图片。HTML 应在图片位置保留 alt/占位及 warning；PDF 使用同一投影并打印 warning。Reader 的文本 source 始终可以导出为 quote + location；region source 必须导出图片（内联成功时）和 location，图片缺失时至少保留 location 与可见的缺图诊断。

## Memorilo 资产协议

- 传输层定义协议为 `memorilo`，资产 host 为 `asset`，规范 origin 为 `memorilo://asset`。[`apps/desktop/api/src/transport.ts:1-10`](../../apps/desktop/api/src/transport.ts#L1-L10)
- 规范 URI 只能包含一个路径段；协议和 host 必须匹配，不能有用户名、密码、端口、query 或 hash。文件名经过 `decodeURIComponent` 后还必须匹配 UUID v4 加小写字母/数字扩展名；`assetSource` 只生成该规范形式。[`apps/desktop/main/src/assets/asset-uri.ts:7-45`](../../apps/desktop/main/src/assets/asset-uri.ts#L7-L45) 导出 resolver 应复用此解析器，拒绝路径穿越、非规范 URL，并将拒绝记录为 `invalid-managed-uri` 诊断。
- Handler 只接受 GET；内存数据库（无资产目录）、文件缺失返回 404，URI 非法返回 400，扩展名不支持返回 415。成功响应按扩展名给出 image MIME、`nosniff` 和一年 immutable cache，并只读取 `join(assetDirectory, fileName)`，不会暴露本地路径。[`apps/desktop/main/src/asset-protocol.ts:5-47`](../../apps/desktop/main/src/asset-protocol.ts#L5-L47)
- `memorilo` scheme 在 Electron 启动时注册为 privileged，开启 `secure`、`standard`、`corsEnabled`、`supportFetchAPI`。[`apps/desktop/main/src/index.ts:42-50`](../../apps/desktop/main/src/index.ts#L42-L50) 因此 renderer 可以让 Chromium 加载该 scheme 的 `<img>`，并可在受控环境尝试 `fetch`；导出仍应把结果读成字节并内联，避免离线文件依赖自定义 scheme。
- 端到端测试验证了 renderer 中的 managed `<img src="memorilo://asset/...">` 可完成加载，同时主进程 `net.fetch` 能读取同一 URL 的字节和 MIME。[`apps/desktop/e2e/tests/image-asset.spec.ts:128-145`](../../apps/desktop/e2e/tests/image-asset.spec.ts#L128-L145) 这证明协议可用于在线预览，但导出文件仍需把响应固化为 data URL。

## 受管资产的存储与边界

- 资产目录位于数据库同目录的 `assets` 子目录；`:memory:` 数据库没有资产目录。[`apps/desktop/main/src/storage/workspace-paths.ts:13-23`](../../apps/desktop/main/src/storage/workspace-paths.ts#L13-L23)
- 保存图片时要求非空 `Uint8Array`、大小不超过 50 MiB，先检测真实图片签名并校验 MIME/扩展名；TIFF 按配置转换。文件名使用随机 UUID，先写入随机临时文件再 rename，随后注册 byte size、MIME 与原始文件名，最后返回 `memorilo://asset/...`。[`apps/desktop/main/src/ipc/asset-service.ts:95-108`](../../apps/desktop/main/src/ipc/asset-service.ts#L95-L108)、[`apps/desktop/main/src/ipc/asset-service.ts:166-223`](../../apps/desktop/main/src/ipc/asset-service.ts#L166-L223)
- 支持的协议扩展名为 avif、bmp、gif、jpg、png、svg、tiff、webp，并映射到固定 image MIME。[`apps/desktop/main/src/asset-protocol.ts:5-14`](../../apps/desktop/main/src/asset-protocol.ts#L5-L14) 内联时 MIME 应来自协议/存储元数据，不应信任文档中用户提供的字符串。
- 资产维护会扫描目录并注册合法文件，按 Note 投影重建引用；引用的文件不存在会返回 `missingAssets`（含原始文件名和引用次数），而不是删除引用。[`apps/desktop/main/src/assets/asset-maintenance.ts:30-48`](../../apps/desktop/main/src/assets/asset-maintenance.ts#L30-L48)、[`apps/desktop/main/src/assets/asset-maintenance.ts:102-127`](../../apps/desktop/main/src/assets/asset-maintenance.ts#L102-L127) 导出应将这类缺失映射为 warning/placeholder。
- 引用投影递归普通 Topic 和嵌入编辑器，额外包含 ImageOcclusion 的原图以及 Reader region 的 `imageSrc`；只有规范 managed URI 会计入受管资产引用。[`apps/desktop/main/src/assets/asset-references.ts:14-49`](../../apps/desktop/main/src/assets/asset-references.ts#L14-L49) 外部 URL 不应假定在资产目录中存在。

## Renderer 与读取方式

主窗口启用 `contextIsolation`、关闭 `nodeIntegration` 并启用 sandbox，renderer 无权读取 Node 文件系统或 `assetDirectory`。[`apps/desktop/main/src/index.ts:94-100`](../../apps/desktop/main/src/index.ts#L94-L100) 现有 Desktop Fetch IPC 也严格限制为 `memorilo://api` host，并把响应转成文本，因此不能用它传输任意 asset 二进制。[`apps/desktop/main/src/ipc/services.ts:101-128`](../../apps/desktop/main/src/ipc/services.ts#L101-L128)

实现上应在主进程提供最小的资源读取适配器（校验 managed URI、读取字节和 MIME、限制大小），或让导出任务在主进程通过受控 protocol/net 边界读取。不要把绝对路径、数据库目录或 Electron IPC URL 写进导出 HTML。若在 renderer 直接 `fetch` 自定义 scheme，仍要检查 `response.ok`、MIME 和字节上限，并把失败转换为结构化诊断。

## 外链资源与降级

网络图片导入已有一套安全边界：只接受 HTTP/HTTPS，使用主进程 `net.fetch`；重定向后仍必须是 HTTP/HTTPS；`content-length` 不得超过 50 MiB；`content-type` 必须以 `image/` 开头；响应字节还会流式限制 50 MiB，最后通过同一图片签名/MIME校验并保存为 managed asset。[`apps/desktop/main/src/ipc/asset-service.ts:307-340`](../../apps/desktop/main/src/ipc/asset-service.ts#L307-L340)、[`apps/desktop/main/src/ipc/asset-service.ts:111-135`](../../apps/desktop/main/src/ipc/asset-service.ts#L111-L135)

导出不能为了内联而隐式调用该导入接口（它会产生持久化文件和数据库记录）。应复用其校验规则，在一次性 export resource resolver 中执行下载：

1. 解析并限制协议为 HTTP/HTTPS；拒绝凭据、异常 URL 或非图片 MIME。
2. 在主进程施加 50 MiB 流式上限和重定向协议检查，读取后转换为 data URL。
3. 网络错误、CORS/协议失败、大小或 MIME 不符时，HTML 可以保留经过转义的原 URL 作为“外链 fallback”但必须插入 warning；PDF 默认输出带 alt/location 的占位框和 warning，避免打印阶段再依赖网络。

编辑器网络图片粘贴同样只识别 HTTP/HTTPS；下载失败时把临时 URL 恢复成原始外链并记录错误，不会静默删除图片。[`packages/editor/src/extension/network-image-paste.ts:8-20`](../../packages/editor/src/extension/network-image-paste.ts#L8-L20)、[`packages/editor/src/extension/network-image-paste.ts:80-93`](../../packages/editor/src/extension/network-image-paste.ts#L80-L93) 导出应采用相同的“保留可见 fallback + 诊断”原则。

每次降级至少记录 `path`（topic/block/node）、`kind`（managed/external/reader-region）、`reason`（404、MIME、超限、网络等）和 `fallback`（data URL、external URL、placeholder、text）。未经转义的外链 URL 不得拼接进 HTML markup。

## Reader source fallback

Reader source 是两种互斥形状：`text` 包含 quote 文本和 location；`region` 包含 `imageSrc` 和 location。linked reference 另外带 annotationId/bookTopicId，但这些字段只用于回到 Reader。[`packages/editor/src/note/topic-reader-reference.ts:1-30`](../../packages/editor/src/note/topic-reader-reference.ts#L1-L30)

编辑器当前对 text 渲染 blockquote，对 region 渲染 `<img alt=location src=imageSrc>`，并在存在 navigation 时包裹 `/reader/$readingId` Link。[`apps/desktop/renderer/src/features/notes/editor/note-editor-topic-chrome.tsx:116-162`](../../apps/desktop/renderer/src/features/notes/editor/note-editor-topic-chrome.tsx#L116-L162) 导出应移除 Link、readingId 和打开 Reader 的行为：

- text source：静态 blockquote + location，始终可离线恢复。
- region source：先按 managed/external resolver 内联图片；失败时显示 location、`Reader region image unavailable` 占位和诊断。不要尝试复制原书文件或依赖 Reader session。
- linked 与 detached reference 使用同一静态投影；annotationId/bookTopicId 可作为非可见诊断元数据，但不应成为导出文件中的可执行导航。

## 对实现的约束

- 资源 resolver 是 HTML/PDF 共用的异步边界；纯同步 Topic 投影只消费已解析的 `data URL | external URL | placeholder` 结果。
- 受管 URI 解析、字节/MIME/50 MiB 校验失败应产生诊断；投影结构错误整体失败，资源缺失则显式降级。
- HTML 必须自包含其 CSS 和成功解析的资源；不写入绝对路径、`memorilo://` 依赖、应用脚本或 IPC 行为。PDF 使用同一中间表示，默认不依赖网络。
