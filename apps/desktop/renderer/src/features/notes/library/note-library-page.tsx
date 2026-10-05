import type {
  DeleteDesktopNoteImpact,
  DesktopNoteFavoriteState,
  DesktopNotePage,
  JournalDate,
  RenameDesktopNoteInput,
  RenameDesktopNoteResult,
  SetDesktopNoteFavoriteInput,
} from '@memorilo/desktop-api'
import type { InfiniteData } from 'effect-query'
import type { PaletteCommand } from '../../../shared/command-palette'
import type { MarkdownImportValues } from '../markdown-import-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { useCommandPaletteCommands } from '../../../shared/command-palette'
import { desktopRequests } from '../../../shared/desktop-requests'
import { MarkdownImportDialog } from '../markdown-import-dialog'
import { defaultTopicId } from '../note-runtime'
import { prepareNoteImport, runNoteExport } from '../note-transfer-operation'

import { noteQueryKeys } from '../query-keys'
import {
  renameNoteMutationOptions,
  setNoteFavoriteMutationOptions,
  updateFavoriteNoteCache,
  updateRenamedNoteCache,
} from './note-library-model'
import { NoteLibraryView } from './note-library-view'

async function openStoredNote(
  noteId: string,
  onOpenJournal: (journalDate: JournalDate) => Promise<void>,
  onOpenNote: (noteId: string, topicId: string) => Promise<void>,
): Promise<void> {
  const stored = await desktopRequests.getNote({ noteId })
  if (stored.kind === 'journal') {
    await onOpenJournal(stored.journalDate)
    return
  }
  const { defaultTopicId } = await import('../note-runtime')
  await onOpenNote(stored.id, defaultTopicId(stored))
}

export function NoteLibraryPage({
  onOpenJournal,
  onOpenNote,
}: {
  onOpenJournal: (journalDate: JournalDate) => Promise<void>
  onOpenNote: (noteId: string, topicId: string) => Promise<void>
}) {
  const { t } = useTranslation(['pages', 'app'])
  const queryClient = useQueryClient()
  const [markdownImport, setMarkdownImport] = useState<{ fileName: string, source: string } | null>(null)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferOperationId, setTransferOperationId] = useState<string | null>(null)
  const { mutateAsync: mutateRenameNote } = useMutation({
    ...renameNoteMutationOptions(),
    onSuccess: (result) => {
      if (result.status !== 'renamed')
        return
      queryClient.setQueriesData<InfiniteData<DesktopNotePage>>(
        { queryKey: noteQueryKeys.lists },
        data => updateRenamedNoteCache(data, result.note),
      )
      void queryClient.invalidateQueries({ queryKey: noteQueryKeys.lists })
      void queryClient.invalidateQueries({ queryKey: noteQueryKeys.favorites })
      void queryClient.invalidateQueries({ queryKey: noteQueryKeys.recent })
    },
  })
  const { mutateAsync: mutateFavoriteNote } = useMutation({
    ...setNoteFavoriteMutationOptions(),
    onSuccess: (state) => {
      queryClient.setQueriesData<InfiniteData<DesktopNotePage>>(
        { queryKey: noteQueryKeys.lists },
        data => updateFavoriteNoteCache(data, state),
      )
      void queryClient.invalidateQueries({ queryKey: noteQueryKeys.favorites })
    },
  })
  const renameNote = useCallback(
    (input: RenameDesktopNoteInput): Promise<RenameDesktopNoteResult> => mutateRenameNote(input),
    [mutateRenameNote],
  )
  const favoriteNote = useCallback(
    (input: SetDesktopNoteFavoriteInput): Promise<DesktopNoteFavoriteState> => mutateFavoriteNote(input),
    [mutateFavoriteNote],
  )
  const getDeleteImpact = useCallback(
    (input: { noteId: string }): Promise<DeleteDesktopNoteImpact> => desktopRequests.getDeleteNoteImpact(input),
    [],
  )
  const deleteNote = useCallback(
    (input: { noteId: string }): Promise<DeleteDesktopNoteImpact> => desktopRequests.deleteNote(input),
    [],
  )
  const openSelectedNote = useCallback(
    (noteId: string) => openStoredNote(noteId, onOpenJournal, onOpenNote),
    [onOpenJournal, onOpenNote],
  )
  const importNote = useCallback(async () => {
    if (transferBusy) {
      return
    }
    setTransferBusy(true)
    try {
      const result = await prepareNoteImport(undefined, undefined, setTransferOperationId)
      if (result.phase === 'cancelled')
        return
      if (result.phase === 'markdown') {
        setMarkdownImport({ fileName: result.fileName, source: result.source })
        return
      }
      if (result.phase === 'failed')
        throw new Error(result.error.message)
      if (result.phase !== 'imported')
        throw new Error('Note import did not complete')
      void queryClient.invalidateQueries({ queryKey: noteQueryKeys.lists })
      if (result.result.kind === 'journal' && result.result.journalDate !== undefined)
        await onOpenJournal(result.result.journalDate)
      else
        await onOpenNote(result.result.noteId, result.result.kind === 'regular' ? defaultTopicId(await desktopRequests.getNote({ noteId: result.result.noteId })) : '')
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setTransferOperationId(null)
      setTransferBusy(false)
    }
  }, [onOpenJournal, onOpenNote, queryClient, transferBusy])
  const confirmMarkdownImport = useCallback(async (values: MarkdownImportValues) => {
    const created = await desktopRequests.createNote({
      initialTopic: {
        initialContent: values.document,
        mode: 0,
        title: values.topicTitle,
      },
      title: values.noteTitle,
    })
    setMarkdownImport(null)
    if (values.diagnostics.length > 0)
      toast.warning(values.diagnostics.map(diagnostic => `L${diagnostic.line}: ${diagnostic.message}`).join('\n'), { autoClose: 10_000 })
    void queryClient.invalidateQueries({ queryKey: noteQueryKeys.lists })
    await onOpenNote(created.id, defaultTopicId(created))
  }, [onOpenNote, queryClient])
  const importCommands = useMemo<readonly PaletteCommand[]>(() => [{
    accent: 'violet',
    action: t('importAction', { ns: 'app' }),
    description: t('importNoteDescription', { ns: 'app' }),
    icon: FileUp,
    id: 'import-note',
    keywords: t('importNoteKeywords', { ns: 'app' }) as unknown as readonly string[],
    label: t('importNote', { ns: 'pages' }),
    run: importNote,
    section: t('navigationSection', { ns: 'app' }) as PaletteCommand['section'],
  }], [importNote, t])
  useCommandPaletteCommands(importCommands)
  const exportNote = useCallback(async (format: 'memo' | 'pdf', noteId: string) => {
    if (transferBusy) {
      return
    }
    setTransferBusy(true)
    try {
      const result = await runNoteExport(format, noteId, undefined, undefined, setTransferOperationId)
      if (result.phase === 'saved') {
        if (result.result.diagnostics.length > 0)
          toast.warning(`${result.result.path}\n${result.result.diagnostics.map(diagnostic => diagnostic.message).join('\n')}`, { autoClose: 10_000 })
        else
          toast.success(result.result.path, { autoClose: 5_000 })
      }
      else if (result.phase === 'failed') {
        throw new Error(result.error.message)
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setTransferOperationId(null)
      setTransferBusy(false)
    }
  }, [transferBusy])
  const cancelTransfer = useCallback(() => {
    if (transferOperationId === null)
      return
    void desktopRequests.cancelNoteTransfer(transferOperationId).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }, [transferOperationId])
  const commands = useMemo(() => ({
    favorite: favoriteNote,
    importNote,
    exportNote,
    open: openSelectedNote,
    rename: renameNote,
    getDeleteImpact,
    delete: deleteNote,
  }), [deleteNote, exportNote, favoriteNote, getDeleteImpact, importNote, openSelectedNote, renameNote])

  return (
    <>
      <NoteLibraryView commands={commands} onCancelTransfer={cancelTransfer} transferBusy={transferBusy} />
      {markdownImport
        ? <MarkdownImportDialog fileName={markdownImport.fileName} onClose={() => setMarkdownImport(null)} onConfirm={confirmMarkdownImport} source={markdownImport.source} target="new-note" />
        : null}
    </>
  )
}
