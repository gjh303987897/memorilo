# Journal feature design

Status: implemented

## Goal

Journal is a chronological workspace over a special kind of Note. Opening `/journals` always presents today's Journal Note first, followed by earlier non-empty Journal Notes in descending Journal Date order.

This design keeps the existing Note aggregate and editor model authoritative. Journal adds date identity, lifecycle rules, an immutable system title, and a virtualized feed; it does not introduce a second document format.

## Research basis

The fixed-version source review is recorded in [Logseq Journals and TanStack Virtual research](./research/logseq-journals-and-tanstack-virtual.md).

The parts worth carrying over from Logseq are the independent date identity, immutable projected title, reuse of the ordinary Page/Block editor, today-first ordering, stable virtual keys, and dynamic-height measurement. Memorilo deliberately differs in two places: Logseq currently loads all Journal IDs rather than paginating them, and no current source path was found that automatically deletes or hides earlier empty Journals. Cursor pagination and empty-Journal deletion are therefore Memorilo domain rules, not copied Logseq behavior.

## Confirmed product rules

- One Journal Date identifies at most one Journal Note.
- Today's Journal Note is always the first feed item and is available even when empty.
- A Journal Note's displayed title is its Journal Date and cannot be renamed.
- A Journal Note contains exactly one unnamed root Topic and never exposes a Note inspector.
- Earlier Journal Notes appear below today in reverse chronological order.
- Earlier empty Journal Notes are hidden immediately; physical deletion may be delayed until a safe collection point.
- The feed uses TanStack Virtual because Journal history can be large.

## Implemented user experience

```text
App titlebar: Journals                                         [Calendar]
--------------------------------------------------------------------------
                         Tuesday, August 4, 2026
                         [today's embedded editor]

--------------------------------------------------------------------------
                         Monday, August 3, 2026
                         [earlier embedded editor]

--------------------------------------------------------------------------
                         Saturday, August 1, 2026
                         [earlier embedded editor]

                         [load/error sentinel]
```

- The route has one vertical scroll container. Embedded editors must not create nested vertical scroll areas.
- Each date is a real heading containing a `<time dateTime="YYYY-MM-DD">`; the localized visible format follows the active application language.
- Date headings are plain, selectable text, not inputs or buttons. The app titlebar remains `Journals` and never exposes the Note rename control.
- Day sections are unframed and separated with restrained whitespace and a subtle divider. They are not cards.
- A compact calendar icon in the titlebar opens a date picker anchored to that control. Dates with an existing Journal are marked.
- Selecting any date through today opens it and scrolls to its feed item. A missing date is created as a temporary empty Journal; an empty past selection remains visible only while it is active.
- The calendar is one shared macOS Tahoe Liquid Glass control surface. Journal content stays opaque and unframed; glass is never stacked on glass.
- The calendar material uses adaptive translucency, a lens-like edge highlight, restrained depth, and immediate press feedback. It provides solid and higher-contrast variants for `prefers-reduced-transparency` and `prefers-contrast`, and a cross-fade-only reduced-motion transition.
- Fetching another history page uses a fixed-height status row so loading and retry states do not resize adjacent Journal Notes.
- Feed insertion, removal, and measurement corrections do not animate. Native scrolling provides the spatial continuity; height animation would fight virtual measurement and move the caret.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and increased contrast continue to follow the existing application policies.

## Domain model

### Calendar identity

`JournalDate` is a strict local calendar date encoded as `YYYY-MM-DD`. It is not derived from `createdAt` or `updatedAt` after creation.

The main process is the authority for today's Journal Date. The renderer asks to open today's Journal without sending a date, preventing separate renderer and main calculations from selecting different days. A clock dependency inside the application module makes midnight and daylight-saving behavior deterministic without exposing a clock through IPC.

Changing system timezone does not rewrite existing Journal Dates. A Journal Note remains attached to the local date under which it was created; asking for today after a timezone change opens or reuses the Journal Note for the new local date.

### Journal Note subtype

A Journal Note remains one Loro-backed Note aggregate as required by ADR 0001. Its Loro metadata owns the subtype identity: `kind = 'journal'`, the canonical `journalDate`, the canonical `journal:YYYY-MM-DD` Note ID, and the matching date title. The `journals` table is a rebuildable persistence projection of that aggregate identity:

```sql
CREATE TABLE notes (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (kind IN ('regular', 'journal')),
  checkpoint_snapshot BLOB,
  checkpoint_sequence INTEGER NOT NULL DEFAULT 0,
  latest_sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE journals (
  note_row_id INTEGER PRIMARY KEY REFERENCES notes(row_id) ON DELETE CASCADE,
  journal_date TEXT NOT NULL UNIQUE,
  has_user_content INTEGER NOT NULL CHECK (has_user_content IN (0, 1))
);

CREATE INDEX journals_feed_idx
  ON journals(has_user_content, journal_date DESC);

CREATE UNIQUE INDEX notes_regular_title_unique
  ON notes(title COLLATE NOCASE)
  WHERE kind = 'regular';
```

The Loro aggregate is authoritative for the subtype. The `journals` row and `notes.kind` column let SQLite query Journal Notes efficiently, enforce regular-Note title uniqueness, and reject projection drift without becoming a second source of identity.

- `notes.kind` is part of the current schema baseline.
- The database enforces one Journal Note per Journal Date under concurrent calls.
- A partial unique index enforces case-insensitive regular-Note titles across independent storage owners while still allowing a regular Note whose title equals a Journal Date.
- Triggers require Journal rows to reference a `kind = 'journal'` Note whose ID is `journal:YYYY-MM-DD` and whose title is the exact canonical date, and prevent later title/kind drift.
- Deleting the Note cascades through existing projections and Journal metadata.
- Journal queries stay explicit instead of teaching every Note query about nullable subtype columns.

Journal creation deterministically initializes the same aggregate identity, root Topic ID, and root Block ID on every device before restoring a device-local editing peer. It then inserts the `notes` and `journals` projections atomically. Renderer display formatting is derived from `journalDate`. Regular Note title uniqueness is evaluated among regular Notes; a regular Note named `2026-08-04` must not prevent that day's Journal Note from being created.

### Immutable title

Immutability is enforced at every writable seam, not only by hiding UI:

- `renameNote` rejects Journal Notes with a typed `journal-title-immutable` result.
- Imported renderer or MCP updates that mutate Journal Note metadata are rejected unless the resulting title still equals `journalDate`.
- Pages, search results, favorites, and recent items derive the visible title from `journalDate` and do not expose rename actions for Journal Notes.

The date is identity; title text is only its projection. Locale switching reformats visible Journal titles without mutating Loro or SQLite.

### Empty content

A Journal Note is empty when its aggregate has only the initial unnamed root Topic and that Topic is semantically blank.

The following do not count as user content:

- the system date title;
- the initial root Topic;
- the canonical empty `doc > paragraph` structure;
- whitespace-only text.

The following do count as user content even if their plain text is empty:

- an image, table, code block, math block, task state, card metadata, or another meaningful node/attribute;
- an explicit Topic title, additional Topic, or Folder is instead an invalid Journal structure and the update is rejected;
- any non-whitespace text.

`EditorNote.hasUserContent()` owns this semantic decision because the editor schema knows which nodes and attributes are meaningful. Storage receives `hasUserContent` as a rebuildable Journal projection during initial persistence and every accepted update. SQLite must not infer emptiness from snapshot byte length, timestamps, or `topic_blocks.text` alone.

## Application interface

Journal behavior belongs behind a small interface in the existing Note application module:

```ts
interface JournalApplication {
  openJournal(input?: {
    journalDate?: JournalDate
  }): Promise<DesktopJournalNote>
  listPastJournals(input?: {
    before?: JournalDate
    limit?: number
  }): Promise<DesktopJournalPage>
  listJournalDates(input: {
    from: JournalDate
    through: JournalDate
  }): Promise<readonly JournalDate[]>
  prunePastEmptyJournals(): Promise<{ deletedNoteIds: readonly string[] }>
}
```

`openJournal` is an idempotent get-or-create operation. Omitting `journalDate` opens today according to the main-process clock; passing a date opens a specific non-future day. It returns a full Note snapshot because the selected row mounts an editor immediately.

`listPastJournals` is read-only and cursor-based. It returns lightweight summaries ordered by `journal_date DESC`, excludes today and `has_user_content = 0`, and uses an exclusive `before` date as its next cursor. Offset pagination is rejected because automatic deletion can shift offsets and duplicate or skip rows.

`listJournalDates` returns only non-empty persisted dates in an inclusive calendar range. The renderer adds today to the displayed marker set, but never marks a temporary empty past selection.

`prunePastEmptyJournals` deletes only rows satisfying both `journal_date < today` and `has_user_content = 0`. The application serialization queue evicts each deleted Note from the authoritative Note cache. The storage deletion is one transaction and also removes vector rows that are not protected by foreign-key cascades.

The preload contract exposes these operations on `DesktopApi`. Generic `DesktopNote` and `DesktopNoteSummary` use a discriminated subtype:

```ts
type DesktopNoteKind
  = { kind: 'regular' }
    | { journalDate: JournalDate, kind: 'journal' }
```

Callers can therefore render and authorize actions without guessing from a title.

## Safe automatic deletion

Visibility and physical deletion are separate. As soon as a saved past Journal projects `has_user_content = 0`, ordinary history queries exclude it. Physical deletion cannot occur immediately after a debounced save marks it empty because the editor may still be mounted and accept another keystroke; deleting at that point would make the next update target an unknown Note.

Implemented collection points are:

1. Entering Journal: flush all pending Note updates, then prune earlier empty Journal Notes before loading the feed.
2. Application shutdown: the existing renderer save handshake completes first; the Note application module checkpoints pending state and prunes before closing storage.

Local date rollover get-or-creates the new today immediately. The former day disappears from ordinary history as soon as its persisted `has_user_content` projection is false; physical deletion can wait for the next collection point.

If flushing fails, pruning does not run. An empty past Journal Note may survive longer, but unsaved content is never traded for cleanup. A Journal Note cleared while it remains mounted can stay as an empty row until the next safe collection point.

Immediate deletion when a virtual row unmounts is not proposed for v1. Virtual rows can unmount and remount during ordinary scrolling, so coupling destructive persistence to that lifecycle creates races and makes fast reverse scrolling unreliable.

## Date rollover

The renderer schedules a wake-up near the next local midnight, then rechecks with the main process instead of assuming that 24 hours elapsed. It also rechecks on window focus and visibility recovery because laptops sleep and clocks or timezones can change.

When a new day is inserted at index 0 while the user is reading history, the renderer captures the first visible Journal Note key and its viewport-relative offset, refreshes the feed, and restores that anchor after measurement. When already at the top, it remains at the top and the new today becomes immediately visible.

## Virtualized feed

The existing resolved TanStack Virtual core is `3.17.7`. The Journal feed uses normal DOM order and the default start anchor:

```ts
useVirtualizer({
  count: journalNotes.length + (hasNextPage ? 1 : 0),
  estimateSize: estimateJournalHeight,
  getItemKey: index => journalNotes[index]?.noteId ?? 'load-more-journals',
  getScrollElement: () => scrollElementRef.current,
  overscan: 2,
})
```

The implemented `overscan` is `2` because each row owns a ProseMirror editor. The measured estimate is `430px`; increasing overscan requires evidence that fast scrolling shows blank rows on target hardware.

Every rendered day wrapper supplies `data-index` and `ref={virtualizer.measureElement}`. The estimate should be a generous typical Journal height, not a tiny minimum, so initial scrollbar corrections are biased toward shrinking rather than repeated downward growth. Default ResizeObserver measurement is used; `useAnimationFrameWithResizeObserver` stays off unless profiling demonstrates a loop warning or measurement defect.

History is appended at the end of the array, so chat-style `anchorTo: 'end'`, reversed flex layout, inverted transforms, and manual reverse scrolling are all incorrect here. The final virtual item is a loader sentinel; seeing it triggers `fetchNextPage` once. A failed page remains a stable retry row and does not repeatedly refetch from the scroll effect.

Date rollover captures the first visible Journal Note ID and its viewport offset, then restores that stable anchor after inserting the new today. A user already at the top stays at the top so the new today is visible immediately.

## Embedded editor mode

The current `EditorCanvas` owns an internal `overflowY: auto` viewport and `minHeight: 100%`, which is correct for the standalone Note route but does not fit a measured Journal row.

`packages/editor` provides an explicit `layout="standalone" | "embedded"` mode:

- `standalone` preserves the current full-height self-scrolling behavior.
- `embedded` uses document flow, no internal vertical overflow, a stable minimum editing height, and feed-owned horizontal padding.

The mode changes layout only. It does not create another editor implementation, schema, command set, or undo history.

Renderer Note loading, Loro subscription, external-update merging, structure validation, persistence receipts, and recovery live in the reusable `features/notes/editor/note-editor-session.ts` module. Both the standalone Note route and Journal rows use that module; route titlebar, inspector, date header, and virtual measurement remain caller-owned view concerns.

Journal keeps up to eight `EditorNote` instances in an LRU cache separate from virtual DOM rows. This preserves Loro undo state when a row briefly leaves the overscan window while bounding memory. Remount merges incremental authoritative updates into the cached instance instead of importing a full snapshot. Leaving Journal clears the cache, and pruning explicitly removes deleted Note IDs.

## Query and consumer behavior

Journal Notes remain visible to generic Note consumers because they are Notes.

- Pages lists them with localized date titles and no rename button.
- Search indexes their content and returns the localized date as the Note label.
- Recent and Favorites may reference them using the same stable Note and Topic IDs.
- Opening a Journal Note from Pages, search, Recent, or Favorites navigates to `/journals` and scrolls to that Journal Date rather than opening the generic Note titlebar.
- MCP reads expose `kind: 'journal'` and canonical `journalDate`; MCP rename rejects them. Content editing continues through existing Note and Topic operations.

This preserves one canonical navigation experience and prevents a second route from exposing controls that violate Journal invariants.

## Failure behavior

- If today's get-or-create fails, the route shows one actionable error state; it does not fabricate an in-memory Note.
- If a past page fails, already loaded and editable Journal Notes remain mounted and the final row offers retry.
- If a Note snapshot fails validation, only that day shows the existing recovery/error UI; the whole feed remains usable.
- If persistence fails, the affected day shows its save error and automatic deletion is suspended.
- If a duplicate-day constraint wins a creation race, `openTodayJournal` rereads and returns the existing Journal Note.
- Unknown dates, invalid cursors, and attempts to rename a Journal fail at the main-process interface rather than silently normalizing input.

## Implemented module changes

### `packages/editor`

- Added the schema-aware `EditorNote.hasUserContent()` query.
- Added the explicit embedded Editor layout without changing editing semantics.

### `packages/editor-storage`

- Added the `journals` subtype table and JournalDate validation.
- Added the Note-kind integrity discriminator, regular-title partial unique index, and Journal identity triggers as part of the current schema baseline.
- Added atomic get-or-create, cursor list, content projection update, date-marker list, and prune operations.
- Added Note deletion cleanup for non-foreign-key vector rows.

### `apps/desktop/main`

- Deepened `NoteApplicationService` with Journal operations, clock ownership, cache eviction, and immutable-title validation.
- Prunes only after renderer save acknowledgement at safe collection points.

### `apps/desktop/preload`

- Exposed the discriminated Journal contracts and flat Journal operations through public entry points.

### `apps/desktop/renderer`

- Replaced the placeholder `/journals` route with an infinite query and TanStack Virtual feed.
- Extracted the reusable Note-session module from the standalone Note route.
- Added Journal-only StyleX files and aligned `app` locale keys for every supported language.
- Added a Tahoe Liquid Glass calendar, focus/visibility-aware date rollover, stable scroll restoration, and localized navigation from Pages, Search, Recent, and Favorites.

## Resolved decisions

1. **Database generation**: the main database generation follows the applied Drizzle migrations; Journal and CardTopic projections use the current schema baseline.
2. **Deletion timing**: use the safe collection points above; a just-cleared past row can remain physically stored while being hidden immediately.
3. **Generic consumers**: keep Journal Notes in Pages, Search, Recent, Favorites, and structured Note reads, with navigation redirected to `/journals?date=...`.
4. **Empty structure**: meaningful non-text nodes count as user content; extra Topics, named Topics, and Folders violate the one-Topic Journal invariant and are rejected.
