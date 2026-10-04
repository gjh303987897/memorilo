Type: research
Status: resolved
Blocked by: 02

## Question

Which Electron boundary should own PDF generation and saving? Compare `webContents.printToPDF` in a controlled document window with the platform print dialog, and evaluate compiling the static projection through a TypeScript Typst implementation.

## Answer

The main process owns the complete PDF export boundary, but PDF generation uses Typst.ts rather than Chromium printing. The renderer requests `exportPdf(noteId)`; main reads and validates the Note, builds the shared format-neutral `ExportDocument` (including resource resolution and diagnostics), serializes it to Typst source plus an opaque resource manifest, and compiles it with `@myriaddreamin/typst-ts-node-compiler` (`NodeCompiler.compile` + `pdf` returning a `Buffer`). Main also creates the private `.memo` archive from the same flushed snapshot and embeds it as an associated `/EmbeddedFile` in the PDF. The resulting `.memo.pdf` is a real PDF for reading and a lossless import carrier for Memorilo; it is not a filename-only combination of two files. The HTML serializer remains a separate consumer of the same projection. No hidden BrowserWindow or editor DOM is involved.

`webContents.print` and `webContents.printToPDF` remain optional, separate print features; they are not the PDF export implementation. Typst compilation gives a deterministic byte result and keeps file writing under the main process. The platform print dialog can still be exposed as a distinct “Print” command.

Typst output uses fixed product defaults: A4 portrait, explicit page margins, deterministic heading hierarchy, and explicit page-break markers in the projection. Fonts are bundled and loaded explicitly (including CJK coverage); default CDN font loading and compiler network access are disabled. Managed and downloaded external images are injected into a temporary Typst workspace or access model under opaque paths. Math, tables, SVG/PNG, and static whiteboard/image-occlusion projections are serialized to Typst-native constructs; unsupported conversions produce diagnostics and readable fallbacks.

The save dialog presents the final filename as `<title>.memo.pdf` and a PDF filter. Import classifies a selected `.memo.pdf` by extracting the embedded Memo attachment and passing it through the strict `.memo` preflight/commit path; a normal PDF without the attachment is rejected as unsupported. The private standalone `.memo` archive remains an internal/export-contract format, but the user-facing Note export menu exposes HTML and Memo PDF together rather than separate “Export Memo” and “Export PDF” actions.

Saving is atomic and follows the existing backup pattern: write the Typst-produced PDF buffer to a uniquely named temporary file in the destination directory, then `rename` it into place; clean up on every failure and let the native dialog handle overwrite confirmation. If the user cancels, return `{ status: 'cancelled' }` before creating or truncating any file. A minimal result contract is:

```ts
type ExportPdfResult =
  | { status: 'saved', path: string, diagnostics: readonly ExportDiagnostic[] }
  | { status: 'cancelled' }
  | { status: 'failed', code: 'projection' | 'compile' | 'save' | 'cancelled-by-shutdown', message: string }
```

Concurrent exports for one Note are serialized or rejected by a main-process operation supervisor; compiler instances/worlds are not shared across concurrent jobs without isolation. Renderer code never passes Typst source, arbitrary paths, scripts, or `BrowserWindow` handles. The native Node compiler is preferred for Electron, with the WASM `typst.ts` backend retained only as an explicit fallback because it adds a roughly 27 MiB WASM payload and requires a custom virtual filesystem/font loader.

Research basis: [Note Typst PDF generation and save boundary](../../../docs/research/note-export-typst-pdf.md).
