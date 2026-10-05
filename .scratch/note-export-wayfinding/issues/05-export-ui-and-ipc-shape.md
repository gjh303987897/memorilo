Type: prototype
Status: resolved
Blocked by: 01, 02, 03, 04

## Question

Where should Note export/import commands live, and what small renderer/main API should expose them? Produce a concrete interaction outline covering titlebar/menu discoverability, disabled/progress/cancel states, success and failure feedback, keyboard accessibility, localization, and route behavior after importing a Note.

## Comments

Prepared [interaction proposal](../prototype/interaction-outline.md) and [interactive state prototype](../prototype/note-transfer.html). The proposal covers Library/Note entry points, snapshot flushing, warning acceptance, main-owned cancellation, atomic commit, Regular/Journal import conflicts, localized feedback, and an operation-based contextual API. Awaiting user feedback; no resolution has been recorded yet.

Browser verification: all seven guided scenarios reached their expected terminal state and simulated write count. Desktop (1100px) and narrow (390px) screenshots were captured; the narrow viewport has no horizontal overflow. No production code or persistent test files were added, and no commit was made.

## Answer

Expose one “Import…” action in the Library and one matching global command. Both open the same native picker for `.memo`, `.md`, and `.markdown`; the application selects the import workflow after file selection. `.memo` is always parsed with strict Memo validation and never falls back to Markdown, while `.md` and `.markdown` retain the existing Markdown preview/options flow. Unsupported extensions are rejected before mutation.

Export remains Note-scoped through a titlebar menu, Library context menu, and format-specific commands. The user-facing export choices are HTML and Memo PDF; Memo PDF is a real `<title>.memo.pdf` containing a Typst-rendered PDF plus an embedded `.memo` attachment. The renderer starts an opaque operation and renders its discriminated state; main owns file dialogs, snapshot/asset/Typst work, Memo attachment handling, cancellation, and the final atomic file or database commit. The accepted interaction and API contract are captured in [interaction-outline.md](../prototype/interaction-outline.md), with state behavior demonstrated by [note-transfer.html](../prototype/note-transfer.html).
