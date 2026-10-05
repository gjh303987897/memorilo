# Note PDF 生成与保存边界调研

调研日期：2026-09-04  
Electron 版本：`43.2.0`（`apps/desktop/package.json`）

## 结论

最终实现由主进程拥有完整边界，但不使用 Chromium `webContents.printToPDF`：renderer 只发送经过 schema 校验的 `exportPdf(noteId)` 请求；主进程构造共享静态投影，将其编译为 Typst PDF，并把同一份已校验的 `.memo` TAR+Zstandard archive 作为 PDF `EmbeddedFile` 附件写入增量更新。最终文件是真实可阅读的 `<title>.memo.pdf`，同时是可重新导入的 Memorilo 文件；导入时只接受带有效 Memo 附件的 PDF，普通 PDF 会被拒绝。主进程通过 `dialog.showSaveDialog` 取得目标路径并原子写入（临时文件后 `rename`），取消或生成失败时不创建目标文件。

`webContents.printToPDF` 的 API 语义仍记录在下文，作为被评估但未采用的替代方案；它不参与当前 Memo PDF 实现。

平台打印 API（`webContents.print`）只启动系统打印对话框并通过回调报告成功/失败原因，不返回稳定的 PDF 字节或目标路径；因此它可作为“打印”功能，却不应作为“导出 PDF 文件”的核心实现。[Electron `webContents.print`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions)

## Electron API 语义

### `webContents.printToPDF`

- API 返回 `Promise<Buffer>`，对调用它的 `WebContents` 当前页面执行 Chromium 打印排版；它不会弹出平台保存对话框，也不会自动写文件。[官方 API](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)
- 关键选项包括：`landscape`、`displayHeaderFooter`、`printBackground`、`scale`、`pageSize`（A0–A6、Legal、Letter、Tabloid、Ledger 或 `{ width, height }`；Electron 43 的类型定义规定自定义尺寸单位为英寸）、`margins`、`headerTemplate`/`footerTemplate` 和 `preferCSSPageSize`。`preferCSSPageSize: true` 时优先使用文档的 CSS `@page` 尺寸，否则按 `pageSize`/默认 Letter 排版。[Electron 43.2.0 `electron.d.ts`](../../node_modules/.pnpm/electron@43.2.0/node_modules/electron/electron.d.ts#L23088-L23111)、[官方 `PrintToPDFOptions` 文档](https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options)
- 新版 Electron 还提供 `generateTaggedPDF` 与 `generateDocumentOutline`；目标版本未必支持这些字段，导出层应能力探测或固定到当前版本支持的选项，不能假设跨版本可用。[Electron API history](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)
- 传入已销毁的 `WebContents`、无效页尺寸或渲染进程在排版期间退出会使 Promise reject；调用方应将其映射为结构化导出错误，并确保窗口清理。

### `webContents.print`

`contents.print(options, callback)`将当前页面交给系统打印栈。回调签名为 `(success, failureReason)`；取消打印通常以 `success === false`、`failureReason === 'cancelled'` 表示，其他平台/驱动可能返回 `failed` 或 `not-found`。该 API 不保证可取得 PDF `Buffer`，也不提供统一的保存路径语义。[官方 API](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions)

### 页面就绪与窗口生命周期

- `BrowserWindow({ show: false })` 可创建不可见的临时窗口；应在 `did-finish-load`（而非仅 `dom-ready`）后开始导出，并监听 `render-process-gone`、`closed` 以处理中断。[BrowserWindow 构造选项](https://www.electronjs.org/docs/latest/api/browser-window)、[`did-finish-load`](https://www.electronjs.org/docs/latest/api/web-contents#event-did-finish-load)、[`render-process-gone`](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone)
- `did-finish-load` 只表示主文档加载完成；字体和图片仍可能异步加载。导出前应在该窗口执行受限的 `webContents.executeJavaScript` 检查 `await document.fonts.ready`，并等待所有 `<img>` 的 `complete && naturalWidth > 0`（失败图片转换为投影层的占位和 warning）。不要等待网络外链无限期加载；静态投影应优先使用已内联的 managed asset。
- 在 `finally` 中移除一次性事件监听并调用 `window.destroy()`（或先 `close()` 再确认 `isDestroyed()`）；销毁前检查 `webContents.isDestroyed()`，避免对失效对象继续执行脚本或打印。[BrowserWindow `destroy`/`isDestroyed`](https://www.electronjs.org/docs/latest/api/browser-window)

## 保存与取消边界

`dialog.showSaveDialog(browserWindow, options)` 返回 `Promise<SaveDialogReturnValue>`；用户取消时 `canceled: true`，`filePath` 可能为空（类型和平台版本略有差异）。调用方应先检查 `canceled`，再验证非空路径。取消必须在生成或写入之前短路，并返回 `{ status: 'cancelled' }`，不得创建空文件。[官方 `dialog.showSaveDialog`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogbrowserwindow-options)

推荐顺序：

1. 先完成并校验静态投影（包括资源解析和诊断），再显示保存对话框；这样用户不会选择路径后才发现内容无法生成。
2. 用户确认路径后创建临时文件（与目标同目录、随机名称、独占创建），将 `Buffer` 写入并 `fsync`（如需要），最后 `rename` 到目标路径。写入/打印失败时删除临时文件；不要直接覆盖目标文件。
3. 所有分支均在 `finally` 销毁隐藏窗口。若目标路径已存在，遵循系统保存对话框的覆盖确认，不在导出器内自行删除或截断。

仓库已有数据库导出遵循同样的临时文件 + `rename` 原子模式：`writeCompressedArchive` 在目标目录创建随机 `.tmp`，完成后 `rename`，失败清理临时文件；上层 `exportDatabase` 负责 staging 目录清理。[`apps/desktop/main/src/backup/database-export.ts:91-145`](../../apps/desktop/main/src/backup/database-export.ts#L91-L145)、[`apps/desktop/main/src/backup/database-export.ts:147-198`](../../apps/desktop/main/src/backup/database-export.ts#L147-L198)

现有备份应用把保存/打开对话框绑定到 IPC sender 对应的 `BrowserWindow`，并将取消统一映射为 `status: 'cancelled'`；PDF 导出应复用这一 owner 解析和返回契约。[`apps/desktop/main/src/backup/backup-application.ts:45-62`](../../apps/desktop/main/src/backup/backup-application.ts#L45-L62)、[`apps/desktop/main/src/backup/backup-application.ts:104-134`](../../apps/desktop/main/src/backup/backup-application.ts#L104-L134)、[`apps/desktop/main/src/ipc/backup-service.ts:6-17`](../../apps/desktop/main/src/ipc/backup-service.ts#L6-L17)

## 页面尺寸、字体与图片

- 统一使用 CSS `@page { size: ...; margin: ... }` 与 `preferCSSPageSize: true`，并在 `printToPDF` 选项中设置稳定的 fallback `pageSize` 和显式 `margins`；避免依赖用户打印机默认值。A4/Letter 等预设尺寸通过 Electron 选项传递；Electron 43 的自定义 `{ width, height }` 使用英寸。[Electron 43.2.0 `electron.d.ts`](../../node_modules/.pnpm/electron@43.2.0/node_modules/electron/electron.d.ts#L23106-L23111)
- 导出 HTML 必须自包含 CSS、字体（或使用可用系统字体栈）和成功解析的资源；字体未就绪会导致换行变化，因此要等待 `document.fonts.ready` 后再打印。图片等待应检查 natural dimensions，超时或错误图片必须转成可见 placeholder，不能让 Chromium 打印出空白区域。
- 由于 PDF 生成发生在主进程拥有的临时窗口，renderer 的应用路由、React state、IPC 行为和自定义 `memorilo:` URL 不应进入最终文件；资源应在投影阶段转成 data URL。具体资源边界见 [note-export-assets.md](note-export-assets.md)。

## 推荐 IPC 合约与失败映射

```ts
type ExportPdfResult =
  | { status: 'saved'; path: string; diagnostics: readonly ExportDiagnostic[] }
  | { status: 'cancelled' }
  | { status: 'failed'; code: 'projection' | 'print' | 'save' | 'window-closed'; message: string }
```

Renderer 不应传递 HTML 任意脚本、绝对路径或 `BrowserWindow` 引用；main 负责 Note 读取、投影、资源解析、窗口生命周期、打印和保存。为避免竞态，同一 Note 的并发导出应由主进程操作监督器串行化或拒绝，窗口关闭/应用退出时中止未完成任务。

## Sources

- [Electron `webContents.printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)
- [Electron PrintToPDFOptions structure](https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options)
- [Electron `webContents.print`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron WebContents lifecycle events](https://www.electronjs.org/docs/latest/api/web-contents#instance-events)
- [Electron `dialog.showSaveDialog`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogbrowserwindow-options)
- [`database-export.ts` atomic save implementation](../../apps/desktop/main/src/backup/database-export.ts)
