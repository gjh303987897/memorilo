# Note Export And Import Wayfinding

Label: wayfinder:map
Status: resolved

## Destination

Produce an implementation-ready specification for exporting one Memorilo Note as a private `.memo` archive, a self-contained readable HTML document, or a `.memo.pdf` document (a real Typst-rendered PDF carrying the re-importable Memo archive as an embedded attachment), with a defined re-import workflow and no accidental loss of Note data.

## Notes

Domain: Electron desktop, renderer/editor serialization, Note persistence, native file dialogs, and document rendering.

Consult `apple-design` when deciding titlebar/menu placement, feedback, reduced motion, or native-feeling save/import interactions. Preserve the repository preference not to add tests unless the user explicitly requests them; existing focused checks remain allowed during implementation.

## Decisions so far

- [Memo import identity and collision policy](issues/01-memo-import-identity.md): `.memo` imports create an independent Regular Note copy with a new NoteID and remapped globally unique learning identities; Journal Notes retain their date identity and reject collisions; all invalid or unsupported files fail atomically.
- [HTML/PDF content fidelity](issues/02-html-pdf-content-fidelity.md): both formats consume one validated static projection; rich content is preserved, interactive content is frozen, and every unsupported/resource failure is visible and diagnosed.
- [资源内联与资产处理](issues/03-resource-inlining-and-assets.md): 主进程受控 resolver 将受管资源转为 data URL；外链按 HTTP(S)/50 MiB 规则显式下载或带诊断降级，Reader source 始终保留可读 fallback。
- [PDF 生成与保存边界](issues/04-pdf-save-boundary.md): 主进程用 Typst.ts Node 编译共享 `ExportDocument`，再把 `.memo` 作为 PDF 附件嵌入并以临时文件加原子 `rename` 保存；导入 `.memo.pdf` 只提取附件，不接受普通 PDF。
- [导入导出交互与 IPC 边界](issues/05-export-ui-and-ipc-shape.md): Library 只提供一个“导入…”入口，程序按所选文件严格分派 Memo 或 Markdown 流程；导出按格式显式选择，renderer 只驱动操作状态，main 持有文件、编译、取消与原子提交边界。
- [Memo 容器与导入事务](issues/06-memo-container-and-import-transaction.md): `.memo` 使用 TAR + Zstandard、逐项 SHA-256 和完整资源载荷；Regular Note 经语义克隆与全局学习身份重映射后原子创建，Journal 保留 canonical 身份与协作谱系，所有个人学习和工作区状态均排除。

## Not yet specified

None.

## Out of scope

- Whole-database backup/restore; that remains owned by the existing backup flow.
- A public interchange format or compatibility promise with other note applications.
