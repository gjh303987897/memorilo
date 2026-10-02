import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditorNote } from '@memorilo/editor/note'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createDeviceTodoModule } from './device-todo'

describe('device Todo module', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('projects tasks through a read-only device credential', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-todo-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    await database.auth.provisionAccount({ accountId: 'account-1', createdAt: 1, enabledModes: ['authoritative'], passwordHash: 'unused', requireEmpty: true, username: 'owner' })
    const note = createEditorNote({ id: 'note-1', initialTopicHeading: 'Topic' })
    const topic = note.getEntries().find(entry => entry.kind === 'topic')
    if (!topic || topic.kind !== 'topic')
      throw new Error('Missing topic')
    note.applyTopicBlockEdits({
      edits: [{ attributes: { dueDate: '2026-09-01', status: 'todo', allDay: true }, content: [{ content: [{ text: 'Buy milk', type: 'text' }], type: 'paragraph' }], kind: 'task', operation: 'insert-block' }],
      topicId: topic.id,
    })
    const snapshot = Buffer.from(note.exportSnapshot()).toString('base64url')
    await database.repository.mergeNoteSnapshot!('account-1', 0, 'note-1', snapshot, 2)
    const module = createDeviceTodoModule({ repository: database.repository, store: database.deviceTodo, now: () => Date.parse('2026-09-01T08:00:00Z') })
    const issued = await Effect.runPromise(module.issueToken({ accountId: 'account-1', deviceName: 'E-paper', expiresAt: Date.parse('2027-01-01T00:00:00Z'), scopes: ['todos:read'] }))
    const listed = await Effect.runPromise(module.list({ date: '2026-09-01', limit: 20, token: issued.token, view: 'today' }))
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({ status: 'todo', text: 'Buy milk' })
    await expect(Effect.runPromise(module.issueToken({ accountId: 'account-1', deviceName: 'Too long', expiresAt: Date.parse('2028-01-01T00:00:00Z'), scopes: ['todos:read'] }))).rejects.toMatchObject({ code: 'invalid_request' })

    const dirtyModule = createDeviceTodoModule({
      repository: {
        ...database.repository,
        listNoteSnapshots: async () => [
          ...(await database.repository.listNoteSnapshots('account-1', 0)),
          { accountId: 'account-1', generation: 0, noteId: 'broken', snapshot: 'not-a-note', frontier: {}, updatedAt: 3 },
        ],
      },
      store: database.deviceTodo,
      now: () => Date.parse('2026-09-01T08:00:00Z'),
    })
    const dirtyListed = await Effect.runPromise(dirtyModule.list({ date: '2026-09-01', limit: 20, token: issued.token, view: 'today' }))
    expect(dirtyListed.items).toHaveLength(1)
    database.close()
  })
})
