Type: grilling
Status: resolved
Blocked by: 01, 03, 05

## Question

What versioned private `.memo` envelope and atomic import transaction should Memorilo use? Decide how the snapshot and managed assets are packaged and validated, where the trust boundary sits, and how the complete Note identity graph is remapped without importing review history or leaving stale Card/Review Target/Reading Item references. The contract must preserve Journal identity and reject Journal conflicts without writes, and it must explicitly settle version compatibility rather than assuming forward compatibility.

## Comments

Round one decisions:

- Use Zstandard compression for the Memo container.
- Every referenced managed asset is required; missing or invalid managed resources fail Memo export instead of producing a degraded archive. External HTTP(S) references remain external and are not downloaded implicitly.
- Reject future versions. Import older versions only through an explicit supported migration; version 1 initially has no speculative compatibility path.
- “Private” means a Memorilo-specific interchange format, not encrypted storage. Include integrity checks, but no encryption or signature in version 1.

Round two decisions:

- A `.memo` file is a TAR container compressed as one Zstandard frame, with fixed internal paths beneath `manifest.json`, `note.snapshot`, and `assets/`.
- A Regular Note import rebuilds the current state in a fresh Loro document so the Imported Note Copy has independent collaboration lineage. A Journal import retains the validated source snapshot and lineage while preserving its canonical NoteID and Journal Date. Neither path imports undo state, Review Events, or Learning State.
- When an asset file name already exists with different bytes, do not overwrite it or reject immediately. Ask whether to use the local asset or assign the imported asset a new file name and rewrite the imported Note's references.
- Invalid input completes preflight without persistent writes. Final commit guarantees that no partial Note becomes visible; failures clean up newly published assets, while crash-only orphan assets may be recovered and reclaimed on startup.
- Imported database records use the import time for creation/activity timestamps. The Memo manifest retains only export time and source application version as diagnostic provenance.

Round three decisions:

- Present all same-name/different-content asset conflicts in one post-preflight review. Each conflict independently offers “import with a new asset name” or “use local”, defaults to preserving the imported bytes under a new name, supports applying one choice to all conflicts, and always permits cancelling the whole import. Choosing local explicitly warns that imported content will differ from the source.
- Journal import may rewrite conflicting asset URIs through one local CRDT update while retaining the canonical NoteID, Journal Date, and imported collaboration lineage.
- The manifest is authoritative for envelope versioning, byte lengths, and checksums; the snapshot is authoritative for Note content and identity. Any duplicated identity field must match exactly.
- Regular Note remapping is a two-pass semantic transformation owned by `packages/editor`: collect and validate the complete identity graph, then build a fresh Loro document and rewrite every identity that projects as a CardID or Reading Item ID. Review Target IDs are regenerated from remapped CardIDs and preserved local BlockIDs. Note-local Topic, Block, Sheet, ordinary OcclusionShape, and Embedded Editor identities remain unchanged. SQLite projections are derived only from the transformed document.
- Import streams Zstandard and TAR with hard initial limits of 256 MiB for `note.snapshot`, 50 MiB per asset, 2 GiB total uncompressed bytes, and 10,000 assets. Exceeding a limit rejects atomically. These are importer policy rather than a Memo format-version promise.

Final-round decisions:

- Memo carries Note content and the snapshot's `learningEnabled` value, but excludes Favorite/recent activity, FSRS Optimizer assignments, Review Events, Learning State, and Reading Item processing state, priority, schedule, and read point. Rebuilt learning projections start from the target workspace's Global FSRS Optimizer and initial states.
- Memo includes the exact bytes of every BookFile bound by a BookTopic. An unavailable or hash-mismatched BookFile fails export. Import reuses an existing Shelf file only when format and SHA-256 match; otherwise it retains the verified file in the Shelf library. BookFile bytes count toward the total uncompressed limit.

## Answer

### Envelope

`.memo` version 1 is one Zstandard frame containing a TAR stream. The fixed layout is:

```text
manifest.json
note.snapshot
assets/<canonical-managed-file-name>
books/<sha256>.<format>
```

`manifest.json` is the first TAR entry and declares `format: "memorilo.memo"`, `formatVersion: 1`, source application version, export timestamp, Note kind/title/source NoteID, optional Journal Date, Note schema version, and descriptors for the snapshot, managed assets, and BookFiles. Every payload descriptor contains its canonical path, byte length, and SHA-256; asset descriptors also retain file name, original file name, and MIME type. Book descriptors retain the BookFile format and original name. Descriptor lists and TAR entries use stable lexical ordering.

The manifest owns envelope interpretation, lengths, and digests. The validated snapshot owns Note content and identity. Repeated identity fields must agree exactly. The Zstandard frame checksum detects transport corruption; SHA-256 binds every declared payload to the manifest, but neither mechanism claims authenticity. Version 1 is not encrypted or signed and must be presented as containing the Note's original content.

Only regular files at the exact declared paths are allowed. Absolute paths, `..`, duplicate entries, undeclared entries, links, devices, sparse files, and unsupported TAR extensions reject the file. Import streams decompression and extraction with limits of 256 MiB for `note.snapshot`, 50 MiB per managed asset, 2 GiB for all uncompressed entries, and 10,000 managed assets. BookFiles are bounded by the total limit and their declared byte lengths. These safety limits may change without changing `formatVersion`.

Electron main can compose the existing `tar-stream` dependency with Node's streaming Zstandard transform. Export reads one flushed, immutable Note snapshot; every referenced managed asset and bound BookFile must exist and match its descriptor. Missing or invalid resources fail Memo export. External HTTP(S) references remain references and are never fetched implicitly.

### Compatibility and preflight

The single Import action routes `.memo` files to this strict decoder and Markdown extensions to the existing Markdown flow. A Memo must also have the expected Zstandard frame and manifest identity; malformed Memo input never falls back to Markdown.

`formatVersion: 1` initially has one reader. A future application may add explicit, ordered migrations from known older envelope versions into the current in-memory candidate. Unknown and future envelope versions, unsupported Note schema versions, failed migrations, malformed archives, digest mismatches, invalid snapshots, projection failures, and resource-limit failures reject without persistent database or asset-library writes.

Preflight stages all verified bytes in an operation-owned temporary directory, restores the source snapshot using its declared source NoteID, validates every Topic/editor projection and identity relation, verifies Journal invariants, and derives the complete managed-asset and BookFile reference sets from the restored Note. Manifest entries must match those derived sets exactly. Temporary staging is disposed on cancellation or failure.

### Identity transformation

Regular import creates an Imported Note Copy. `packages/editor` owns a two-pass semantic clone operation: the first pass enumerates and validates the complete current-state identity graph; the second builds a fresh Loro document with a new NoteID and the user-confirmed unique title while applying one total remapping table. It remaps every identity that can project as a CardID, including Card delimiter directions, Cloze cards, ImageOcclusion groups, and their internal references. It also remaps every Highlight identity that projects as a Reading Item ID and every reference to those Highlights. Review Target IDs are then deterministically regenerated from the new CardIDs and preserved item BlockIDs.

Topic, Block, Sheet, Row, Column, ordinary OcclusionShape, Card definition, ClozeGroup, and Embedded Editor identities remain Note-local and are preserved. The clone contains current semantic state only, with fresh collaboration lineage and no imported undo or update history. Any unclassified globally persisted identity or dangling reference fails preflight rather than surviving unchanged. SQLite Note, content, search, asset-reference, Card, Review Target, and Reading Item projections are derived only from the transformed document; imported database projections are never trusted as input.

Journal import retains the source snapshot and collaboration lineage. Its NoteID, Journal Date, and title must be canonical, non-future, and absent locally at final commit. NoteID or date collision is a hard refusal. If an imported asset must receive a new name, main applies one validated local CRDT update to its URI before the final snapshot is persisted; this does not change Journal identity.

### Resource conflicts

An absent managed asset keeps its imported canonical file name. An existing file with the same name and SHA-256 is reused. Same-name/different-content conflicts are collected after full preflight and shown in one review UI. Each defaults to “import with a new asset name”, may instead use the local file, and supports applying a choice to all conflicts. Choosing local is an explicit content substitution and produces a visible warning; choosing a new name rewrites every imported reference. Neither choice overwrites an existing file, and cancelling rejects the whole candidate.

BookFiles are keyed by format and content SHA-256. An exact local match is reused; otherwise the verified bytes are retained in the Shelf library before the Note becomes visible. Retrieval hints may be refreshed to the local retained reading identifier without changing BookFile identity.

### Atomic commit

Main owns staging and filesystem publication under an Effect scope; `packages/editor-storage` owns one dedicated create-only import operation. The storage operation must accept the final snapshot, complete Note/content projections, asset registrations and references, initial Card/Review Target/Reading Item projections, and optional Journal metadata, then execute all SQLite commands in one ordered atomic batch. It must not compose the current `journals.getOrCreate` behavior, because a raced Journal must fail rather than return an existing Journal.

After user confirmation, main serializes the commit against Note and asset operations, rechecks the unique Regular title or Journal identity, asset collision choices, and available BookFiles, then publishes only new verified files with collision-safe renames. The SQLite batch creates the Note and all projections with import-time timestamps. It creates empty Learning States under the target workspace's effective Global FSRS Optimizer and new Reading Items with their initial processing state; it imports no optimizer assignment, review history, sync history, Favorite, or source activity record. Opening the imported Note afterward may record ordinary local activity at the import time.

If publication or the SQLite batch fails, the transaction rolls back and main removes every file created by that operation. A process crash may leave unreferenced published files, but never a partial visible Note; startup import recovery plus existing managed-asset maintenance reclaim those orphans. Invalid input never reaches publication and therefore causes no persistent writes. A cancel that loses the race with the final batch reports the actual imported result.
