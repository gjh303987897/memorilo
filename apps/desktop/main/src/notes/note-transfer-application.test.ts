import type { EditorStorage } from '@memorilo/editor-storage'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdDecompress } from 'node:zlib'
import { createEditorNote } from '@memorilo/editor/note'
import * as tar from 'tar-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({ dialog: electronMocks }))

const { NoteTransferApplication } = await import('./note-transfer-application')

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function dependencies(note: ReturnType<typeof createEditorNote>) {
  return {
    appVersion: 'test',
    assetDirectory: null,
    flushRenderer: vi.fn(async () => true),
    notes: {
      getNote: vi.fn(async () => ({
        id: note.id,
        kind: 'regular' as const,
        snapshot: note.exportSnapshot(),
        title: note.getTitle(),
      })),
      getNoteTree: vi.fn(async () => ({
        entries: note.getEntries(),
        kind: 'regular' as const,
        noteId: note.id,
        title: note.getTitle(),
      })),
    },
    shelfReadingFiles: {
      deleteFromLibrary: vi.fn(),
      find: vi.fn(async () => undefined),
      readRange: vi.fn(),
      save: vi.fn(),
    },
    storage: { assets: { list: vi.fn(async () => []) } } as unknown as EditorStorage,
  } as never
}

async function unpackMemoArchive(archive: Uint8Array): Promise<Map<string, Uint8Array>> {
  const decompressor = createZstdDecompress()
  const chunks: Buffer[] = []
  decompressor.on('data', chunk => chunks.push(Buffer.from(chunk)))
  await pipeline(Readable.from([archive]), decompressor)

  const entries = new Map<string, Uint8Array>()
  const extract = tar.extract()
  extract.on('entry', (header, stream, next) => {
    const entryChunks: Buffer[] = []
    stream.on('data', chunk => entryChunks.push(Buffer.from(chunk)))
    stream.on('end', () => {
      entries.set(header.name, Buffer.concat(entryChunks))
      next()
    })
    stream.resume()
  })
  await pipeline(Readable.from([Buffer.concat(chunks)]), extract)
  return entries
}

describe('note transfer application Memo boundaries', () => {
  it('exports a readable Memo archive with manifest and snapshot payloads', async () => {
    const note = createEditorNote({ id: 'export-note', title: 'Export me' })
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-note-transfer-test-'))
    temporaryDirectories.push(directory)
    const destination = join(directory, 'exported.memo')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination })

    const application = new NoteTransferApplication(dependencies(note))
    const result = await application.exportMemo(note.id, null)

    expect(result).toMatchObject({ status: 'saved', path: destination })
    const entries = await unpackMemoArchive(await readFile(destination))
    expect([...entries.keys()]).toEqual(['manifest.json', 'note.snapshot'])
    expect(JSON.parse(new TextDecoder().decode(entries.get('manifest.json')))).toMatchObject({
      format: 'memorilo.memo',
      formatVersion: 1,
      note: { kind: 'regular', sourceId: note.id, title: 'Export me' },
      snapshot: { path: 'note.snapshot' },
    })
    expect(entries.get('note.snapshot')).toEqual(Buffer.from(note.exportSnapshot()))
    await application.close()
  })

  it('rejects a normal PDF through the public import operation', async () => {
    const note = createEditorNote({ id: 'import-note', title: 'Import target' })
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-note-transfer-test-'))
    temporaryDirectories.push(directory)
    const source = join(directory, 'ordinary.pdf')
    await writeFile(source, '%PDF-1.7\n%%EOF\n')
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })

    const application = new NoteTransferApplication(dependencies(note))
    const { operationId } = application.prepareImport(null, 7)
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = application.getTransfer(operationId, 7)
      if (state.phase === 'failed') {
        expect(state.error.message).toContain('Unsupported Note file extension')
        await application.close()
        return
      }
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    throw new Error('Import operation did not finish')
  })
})
