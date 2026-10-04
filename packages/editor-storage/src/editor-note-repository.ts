import type { DatabaseCommand, EditorStorageDatabase, StorageOperationRunner } from './database-driver'
import type { EditorNoteRecords } from './editor-note-records'
import type {
  CheckpointNoteInput,
  CreateImportedNoteInput,
  CreateInitializedNoteInput,
  CreateNoteInput,
  NoteWriteReceipt,
  ReconcileNoteAssetReferencesInput,
  SaveNoteUpdatesInput,
  StoredNote,
} from './editor-storage-contracts'
import type { LearningCardReconciliationPlanner } from './learning/learning-card-reconciliation'
import type { ReadingItemProjection } from './learning/types'
import { eq } from 'drizzle-orm'
import { assets, journals, noteAssetReferences, notes } from './drizzle-schema'
import { validateAssetFileName } from './editor-asset-repository'
import { saveNoteUpdates } from './editor-note-updates'
import { assertNonEmpty } from './editor-storage-shared'
import {
  validateAssetReferences,
  validateBinary,
  validateCompleteLearningProjection,
  validateJournalProjection,
} from './editor-storage-validation'

interface EditorNoteRepositoryOptions {
  database: EditorStorageDatabase
  planLearningCards: LearningCardReconciliationPlanner
  planReadingItems: (noteId: string, items: readonly ReadingItemProjection[]) => Promise<readonly DatabaseCommand[]>
  records: EditorNoteRecords
  runOperation: StorageOperationRunner
}

export class EditorNoteRepository {
  readonly #options: EditorNoteRepositoryOptions

  constructor(options: EditorNoteRepositoryOptions) {
    this.#options = options
  }

  readonly checkpointNote = (input: CheckpointNoteInput): Promise<NoteWriteReceipt> => {
    assertNonEmpty(input.noteId, 'Note id')
    validateBinary(input.snapshot, 'Note checkpoint snapshot')
    if (!Number.isInteger(input.throughSequence) || input.throughSequence < 0)
      throw new RangeError('Note checkpoint sequence must be a non-negative integer')
    const saved = structuredClone(input)

    return this.#options.runOperation(() => this.#options.records.checkpoint(
      saved.noteId,
      saved.snapshot,
      saved.throughSequence,
    ))
  }

  readonly createInitializedNote = (input: CreateInitializedNoteInput): Promise<StoredNote> => {
    const saved = structuredClone(input)
    return this.#options.runOperation(async () => {
      await this.#options.records.assertTitleAvailable(saved.title)
      if (saved.learningCards !== undefined)
        validateCompleteLearningProjection(saved.entries, saved.learningCards)
      const prepared = this.#options.records.prepareInitialized(saved, Date.now())
      const learningCommands = saved.learningCards === undefined
        ? []
        : await this.#options.planLearningCards({
            noteId: saved.id,
            replaceMissingTopics: true,
            topics: saved.learningCards,
          })
      const readingCommands = saved.learningReadingItems === undefined ? [] : await this.#options.planReadingItems(saved.id, saved.learningReadingItems)
      try {
        await this.#options.database.batch([...prepared.commands, ...learningCommands, ...readingCommands])
      }
      catch (error) {
        return this.#options.records.rethrowTitleConflict(error, saved.title)
      }
      return prepared.note
    })
  }

  readonly createImportedNote = (input: CreateImportedNoteInput): Promise<StoredNote> => {
    const saved = structuredClone(input)
    const kind = saved.kind ?? 'regular'
    if (kind !== 'regular' && kind !== 'journal')
      return Promise.reject(new TypeError(`Unsupported imported Note kind: ${String(kind)}`))
    const journalDate = saved.journalDate
    const journalDateForWrite = journalDate ?? ''
    if (kind === 'journal') {
      if (journalDate === undefined)
        return Promise.reject(new TypeError('Imported Journal Note requires a journal date'))
      validateJournalProjection(saved.entries, saved.topics)
      if (saved.title !== saved.journalDate)
        return Promise.reject(new TypeError('Imported Journal Note title must match its journal date'))
    }
    else if (saved.journalDate !== undefined) {
      return Promise.reject(new TypeError('Imported Regular Note cannot contain a journal date'))
    }
    if (saved.assets !== undefined) {
      for (const asset of saved.assets) {
        validateAssetFileName(asset.fileName)
        if (!Number.isInteger(asset.byteSize) || asset.byteSize <= 0)
          return Promise.reject(new RangeError(`Imported Asset ${asset.fileName} must have a positive byte size`))
      }
    }
    if (saved.assetReferences !== undefined)
      validateAssetReferences(saved.assetReferences)
    if (saved.learningCards !== undefined)
      validateCompleteLearningProjection(saved.entries, saved.learningCards)
    return this.#options.runOperation(async () => {
      await this.#options.records.assertTitleAvailable(saved.title)
      if (kind === 'journal') {
        const existing = await this.#options.records.findJournal(journalDateForWrite)
        if (existing)
          throw new Error(`Journal ${saved.journalDate} already exists`)
      }
      const prepared = this.#options.records.prepareInitialized(saved, Date.now(), kind)
      const learningCommands = saved.learningCards === undefined
        ? []
        : await this.#options.planLearningCards({
            noteId: saved.id,
            replaceMissingTopics: true,
            topics: saved.learningCards,
          })
      const readingCommands = saved.learningReadingItems === undefined
        ? []
        : await this.#options.planReadingItems(saved.id, saved.learningReadingItems)
      const assetCommands: DatabaseCommand[] = (saved.assets ?? []).flatMap((asset) => {
        const createdAt = asset.createdAt ?? Date.now()
        return [{
          drizzle: database => database.insert(assets).values({
            byteSize: asset.byteSize,
            createdAt,
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            originalFileName: asset.originalFileName,
            unreferencedAt: createdAt,
          }).onConflictDoNothing().run(),
        }]
      })
      const references = saved.assetReferences ?? []
      const referenceCommands: DatabaseCommand[] = references.map(reference => ({
        drizzle: (database) => {
          const note = database.select({ rowId: notes.rowId }).from(notes).where(eq(notes.id, saved.id)).get()
          if (!note)
            throw new Error(`Imported Note ${saved.id} was not created`)
          database.insert(noteAssetReferences).values({
            assetFileName: reference.fileName,
            noteRowId: note.rowId,
            referenceCount: reference.count,
          }).run()
        },
      }))
      const journalCommands: DatabaseCommand[] = kind === 'journal'
        ? [{
            drizzle: (database) => {
              const note = database.select({ rowId: notes.rowId }).from(notes).where(eq(notes.id, saved.id)).get()
              if (!note)
                throw new Error(`Imported Note ${saved.id} was not created`)
              database.insert(journals).values({
                hasUserContent: saved.hasUserContent === true ? 1 : 0,
                journalDate: journalDateForWrite,
                noteRowId: note.rowId,
              }).run()
            },
          }]
        : []
      try {
        await this.#options.database.batch([
          ...assetCommands,
          ...prepared.commands,
          ...journalCommands,
          ...referenceCommands,
          ...learningCommands,
          ...readingCommands,
        ])
      }
      catch (error) {
        return this.#options.records.rethrowTitleConflict(error, saved.title)
      }
      return prepared.note
    })
  }

  readonly reconcileNoteAssetReferences = (input: ReconcileNoteAssetReferencesInput): Promise<boolean> => {
    assertNonEmpty(input.noteId, 'Note id')
    if (!Number.isInteger(input.expectedLatestSequence) || input.expectedLatestSequence < 0)
      throw new RangeError('Expected Note sequence must be a non-negative integer')
    validateAssetReferences(input.references)
    input.allowedMissingAssetFileNames?.forEach(validateAssetFileName)
    const saved = structuredClone(input)
    return this.#options.runOperation(() => this.#options.records.reconcileAssetReferences(
      saved.noteId,
      saved.expectedLatestSequence,
      saved.references,
      saved.allowedMissingAssetFileNames,
    ))
  }

  readonly createNote = (input: CreateNoteInput = {}): Promise<StoredNote> => {
    const title = input.title?.trim() ?? 'Untitled'
    assertNonEmpty(title, 'Note title')
    return this.#options.runOperation(() => this.#options.records.create(title))
  }

  readonly saveNoteUpdates = (input: SaveNoteUpdatesInput): Promise<NoteWriteReceipt> => {
    return saveNoteUpdates({
      database: this.#options.database,
      planLearningCards: this.#options.planLearningCards,
      planReadingItems: (noteId, items) => this.#options.planReadingItems(noteId, items),
      records: this.#options.records,
      runOperation: this.#options.runOperation,
    }, input)
  }
}
