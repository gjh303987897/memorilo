import type { TaskStatus } from '@memorilo/editor/task'
import type {
  SyncDeviceTodoScope,
  SyncDeviceTodoStore,
  SyncDeviceTodoToken,
  SyncNoteSnapshotRecord,
  SyncRepository,
} from '@memorilo/sync'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createEditorNote } from '@memorilo/editor/note'
import { parseTaskDueDate, parseTaskTime, readTaskStatus } from '@memorilo/editor/task'
import { Effect } from 'effect'
import { noteSnapshotRevision } from '../infrastructure/database/shared'

const deviceTokenPrefix = 'memorilo-todo-v1.'
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u

export type DeviceTodoErrorCode
  = | 'account_not_authoritative'
    | 'forbidden'
    | 'internal_error'
    | 'invalid_request'
    | 'operation_conflict'
    | 'revision_conflict'
    | 'todo_not_found'
    | 'unauthorized'

export class DeviceTodoError extends Error {
  readonly code: DeviceTodoErrorCode
  readonly currentRevision?: string | null

  constructor(code: DeviceTodoErrorCode, message: string, options?: { readonly cause?: unknown, readonly currentRevision?: string | null }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DeviceTodoError'
    this.code = code
    this.currentRevision = options?.currentRevision
  }
}

export interface DeviceTodoItem {
  readonly allDay: boolean
  readonly dueDate: string | null
  readonly dueTime: string | null
  readonly id: string
  readonly noteTitle: string
  readonly parentId: string | null
  readonly revision: string
  readonly status: TaskStatus
  readonly text: string
  readonly topicTitle: string
}

export interface DeviceTodoSnapshot {
  readonly generatedAt: string
  readonly items: readonly DeviceTodoItem[]
  readonly revision: string
}

export interface DeviceTodoModule {
  readonly issueToken: (input: {
    readonly accountId: string
    readonly deviceName: string
    readonly expiresAt: number
    readonly scopes: readonly SyncDeviceTodoScope[]
  }) => Effect.Effect<{ readonly credential: SyncDeviceTodoToken, readonly token: string }, DeviceTodoError>
  readonly list: (input: {
    readonly date: string
    readonly limit: number
    readonly token: string
    readonly view: 'all' | 'today'
  }) => Effect.Effect<DeviceTodoSnapshot, DeviceTodoError>
  readonly listTokens: (accountId: string) => Effect.Effect<readonly SyncDeviceTodoToken[], DeviceTodoError>
  readonly revokeToken: (accountId: string, deviceId: string) => Effect.Effect<boolean, DeviceTodoError>
}

interface TodoIdentity {
  readonly blockId: string
  readonly noteId: string
  readonly topicId: string
}

interface ProjectedTodo extends DeviceTodoItem, TodoIdentity {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly journalDate: string | null
}

export interface DeviceTodoModuleOptions {
  readonly now?: () => number
  readonly repository: SyncRepository
  readonly store: SyncDeviceTodoStore
}

function fail(error: unknown): DeviceTodoError {
  if (error instanceof DeviceTodoError)
    return error
  if (error instanceof Error && error.message === 'Device todo operation idempotency conflict')
    return new DeviceTodoError('operation_conflict', error.message, { cause: error })
  return new DeviceTodoError('internal_error', 'Device Todo operation failed', { cause: error })
}

function attempt<Result>(operation: () => Promise<Result>): Effect.Effect<Result, DeviceTodoError> {
  return Effect.tryPromise({ catch: fail, try: operation })
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function todoId(identity: TodoIdentity): string {
  return Buffer.from(JSON.stringify([identity.noteId, identity.topicId, identity.blockId]), 'utf8').toString('base64url')
}

function validDate(value: string): boolean {
  if (!isoDatePattern.test(value))
    return false
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year!, month! - 1, day!)
  const date = new Date(timestamp)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function noteRevision(snapshot: SyncNoteSnapshotRecord): string {
  const revision = noteSnapshotRevision(snapshot)
  if (revision === null)
    throw new DeviceTodoError('internal_error', `Note ${snapshot.noteId} does not have a revision`)
  return revision
}

export function deviceTodoRevision(snapshots: readonly SyncNoteSnapshotRecord[]): string {
  const hash = createHash('sha256')
  for (const snapshot of snapshots)
    hash.update(snapshot.noteId).update('\0').update(noteRevision(snapshot)).update('\0')
  return hash.digest('hex')
}

function projectedDate(todo: Pick<ProjectedTodo, 'dueDate' | 'journalDate'>): string | null {
  return todo.dueDate ?? todo.journalDate
}

function projectSnapshot(snapshot: SyncNoteSnapshotRecord): readonly ProjectedTodo[] {
  const revision = noteRevision(snapshot)
  const note = createEditorNote({ id: snapshot.noteId, snapshot: new Uint8Array(Buffer.from(snapshot.snapshot, 'base64url')) })
  const identity = note.getIdentity()
  const journalDate = identity.kind === 'journal' ? identity.journalDate : null
  const noteTitle = note.getTitle()
  const projected: ProjectedTodo[] = []
  for (const entry of note.getEntries()) {
    if (entry.kind !== 'topic')
      continue
    const content = note.getTopicContent(entry.id)
    const blockById = new Map(content.blocks.map(block => [block.id, block]))
    for (const block of content.blocks) {
      if (block.kind !== 'task')
        continue
      let ancestorId = block.parentId
      let todoParent: string | null = null
      const visited = new Set([block.id])
      while (ancestorId !== null) {
        if (visited.has(ancestorId))
          throw new Error(`Todo ${block.id} contains a cyclic parent chain`)
        visited.add(ancestorId)
        const ancestor = blockById.get(ancestorId)
        if (!ancestor)
          break
        if (ancestor.kind === 'task') {
          todoParent = todoId({ blockId: ancestor.id, noteId: snapshot.noteId, topicId: entry.id })
          break
        }
        ancestorId = ancestor.parentId
      }
      const dueDateValue = block.attributes.dueDate
      const dueTimeValue = block.attributes.dueTime
      const dueDate = dueDateValue === undefined || dueDateValue === null ? null : parseTaskDueDate(dueDateValue)
      const dueTime = dueTimeValue === undefined || dueTimeValue === null ? null : parseTaskTime(dueTimeValue)
      if ((dueDateValue !== undefined && dueDateValue !== null && dueDate === null)
        || (dueTimeValue !== undefined && dueTimeValue !== null && dueTime === null)) {
        throw new Error(`Todo ${block.id} contains invalid due metadata`)
      }
      projected.push({
        allDay: block.attributes.allDay === true,
        attributes: block.attributes,
        blockId: block.id,
        dueDate,
        dueTime,
        id: todoId({ blockId: block.id, noteId: snapshot.noteId, topicId: entry.id }),
        journalDate,
        noteId: snapshot.noteId,
        noteTitle,
        parentId: todoParent,
        revision,
        status: readTaskStatus(block.attributes.status),
        text: block.text,
        topicId: entry.id,
        topicTitle: content.title,
      })
    }
  }
  return projected
}

function projectAll(snapshots: readonly SyncNoteSnapshotRecord[]): readonly ProjectedTodo[] {
  return snapshots.flatMap(projectSnapshot).sort((left, right) => {
    const leftDate = projectedDate(left) ?? '9999-12-31'
    const rightDate = projectedDate(right) ?? '9999-12-31'
    return leftDate.localeCompare(rightDate)
      || (left.dueTime ?? '99:99').localeCompare(right.dueTime ?? '99:99')
      || left.noteTitle.localeCompare(right.noteTitle)
      || left.topicTitle.localeCompare(right.topicTitle)
      || left.text.localeCompare(right.text)
      || left.id.localeCompare(right.id)
  })
}

function publicTodo(todo: ProjectedTodo): DeviceTodoItem {
  const { allDay, dueDate, dueTime, id, noteTitle, parentId, revision, status, text, topicTitle } = todo
  return { allDay, dueDate, dueTime, id, noteTitle, parentId, revision, status, text, topicTitle }
}

export function createDeviceTodoModule(options: DeviceTodoModuleOptions): DeviceTodoModule {
  const now = options.now ?? Date.now

  const authorize = async (token: string, scope: SyncDeviceTodoScope): Promise<SyncDeviceTodoToken> => {
    if (!token.startsWith(deviceTokenPrefix) || token.length > 256)
      throw new DeviceTodoError('unauthorized', 'Device token is invalid')
    const credential = await options.store.findToken(tokenHash(token))
    const timestamp = now()
    if (!credential || credential.revokedAt !== null || credential.expiresAt <= timestamp)
      throw new DeviceTodoError('unauthorized', 'Device token is invalid or expired')
    if (!credential.scopes.includes(scope))
      throw new DeviceTodoError('forbidden', `Device token does not grant ${scope}`)
    return credential
  }

  const accountState = async (accountId: string) => {
    const state = await options.repository.getAccountState(accountId)
    if (!state || !state.enabledModes.includes('authoritative'))
      throw new DeviceTodoError('account_not_authoritative', 'Account does not have authoritative Note state')
    return state
  }

  return {
    issueToken: input => attempt(async () => {
      const deviceName = input.deviceName.trim()
      if (deviceName.length < 1 || deviceName.length > 64)
        throw new DeviceTodoError('invalid_request', 'Device name must contain 1-64 characters')
      if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now())
        throw new DeviceTodoError('invalid_request', 'Device token expiry must be in the future')
      const scopes = [...new Set(input.scopes)]
      if (scopes.length !== 1 || scopes[0] !== 'todos:read')
        throw new DeviceTodoError('invalid_request', 'Device Todo is read-only and requires the todos:read scope')
      await accountState(input.accountId)
      const token = `${deviceTokenPrefix}${randomBytes(32).toString('base64url')}`
      const credential = await options.store.createToken({
        accountId: input.accountId,
        createdAt: now(),
        deviceId: `note4:${randomUUID()}`,
        deviceName,
        expiresAt: input.expiresAt,
        scopes,
        tokenHash: tokenHash(token),
      })
      return { credential, token }
    }),
    listTokens: accountId => attempt(() => options.store.listTokens(accountId)),
    revokeToken: (accountId, deviceId) => attempt(() => options.store.revokeToken(accountId, deviceId, now())),
    list: input => attempt(async () => {
      if (!validDate(input.date))
        throw new DeviceTodoError('invalid_request', 'Device Todo date must be a valid YYYY-MM-DD date')
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
        throw new DeviceTodoError('invalid_request', 'Device Todo limit must be between 1 and 100')
      const credential = await authorize(input.token, 'todos:read')
      const state = await accountState(credential.accountId)
      const snapshots = await options.repository.listNoteSnapshots(credential.accountId, state.generation)
      const todos = projectAll(snapshots).filter(todo => input.view === 'all'
        ? todo.status !== 'done'
        : todo.status !== 'done' && projectedDate(todo) === input.date)
      return {
        generatedAt: new Date(now()).toISOString(),
        items: todos.slice(0, input.limit).map(publicTodo),
        revision: deviceTodoRevision(snapshots),
      }
    }),
  }
}
