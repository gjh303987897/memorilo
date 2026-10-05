Type: grilling
Status: resolved
Blocked by:

## Question

What is the user-visible identity and collision policy for a private `.memo` round trip? Decide whether import restores the original Note ID, creates a new Note with remapped identities, replaces an existing Note, or offers an explicit choice. Include behavior for journal Notes, duplicate titles, malformed files, and snapshots from future schema versions.

## Comments

The current persistence model validates the Note ID embedded in a Loro snapshot, so this decision controls whether import can reuse the existing authoritative restore path or needs an identity-remapping/archive format.

User decisions recorded during grilling:

- Preserve the original ID; on duplication, prompt and allow renaming during import.
- Journal Notes may be imported.
- Malformed, unsupported, or invalid files are rejected atomically with no database write.

## Answer

`.memo` import preserves the source snapshot as the authoritative content, but the import mode is explicit: importing into an existing workspace creates an **Imported Note Copy**. The copy receives a newly generated NoteID and a user-confirmed, case-insensitively unique Regular Note title. All globally unique learning identities (CardID, Review Target ID, Reading Item ID, and related references) are regenerated and remapped; Note-local Topic, Block, Sheet, and embedded-editor identities may remain stable. Review history and Learning State are not copied into the new workspace record.

If the source is a Journal Note, its Journal Date identity remains authoritative. Import is allowed only when that Journal Date is valid, not in the future, and absent locally. A Journal Note date collision is rejected; it is never converted to a Regular Note or another Journal Date. A Regular Note ID collision therefore opens the copy flow; a Journal Note ID/date collision is a hard refusal.

The import UI must collect a new title for a Regular Note copy and validate it before any write. Duplicate titles, invalid titles, malformed JSON/base64, unknown memo versions, unsupported Note schema versions, invalid embedded IDs, and projection failures all reject atomically with no database mutation. No forward-compatibility or partial recovery is promised.

This decision keeps Loro's embedded Note identity and SQLite's global learning-key constraints coherent while making the user's “rename” operation mean identity reassignment rather than a cosmetic title edit.
