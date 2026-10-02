import type { DesktopNote, DesktopNoteExternalUpdate, DesktopTodoTask } from '@memorilo/desktop-api'
import type { EditorTopicDocument } from '@memorilo/editor'
import type { ComponentProps } from 'react'
import type { EditorNoteSessionOpened } from '../notes/editor/note-editor-session'
import { Editor, EditorMode } from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { useDesktopConfiguration } from '../../shared/configuration'
import { desktopRequests } from '../../shared/desktop-requests'
import { errorMessage } from '../../shared/error-message'
import { getPlatform } from '../../shared/platform'
import {
  desktopEditorAdapters,
  useEditorNoteSession,
} from '../notes/editor/note-editor-session'
import { useFlushNotePersistence } from '../notes/persistence/note-persistence-hooks'
import { todoDetailSidebarStyles as styles } from './todo-detail-sidebar.stylex'

function TodoDetailEditorLoaded({
  applyExternal,
  opened,
  task,
  topic,
}: {
  applyExternal: (external: DesktopNoteExternalUpdate) => boolean
  opened: EditorNoteSessionOpened<DesktopNote>
  task: DesktopTodoTask
  topic: EditorTopicDocument
}) {
  const { t } = useTranslation('editor')
  const configuration = useDesktopConfiguration()
  const flushNotePersistence = useFlushNotePersistence()
  const adapters = useMemo(
    () => desktopEditorAdapters(configuration.networkImagePasteBehavior, {
      applyExternal,
      flush: flushNotePersistence,
      noteId: task.noteId,
      topicId: task.topicId,
    }),
    [applyExternal, configuration.networkImagePasteBehavior, flushNotePersistence, task.noteId, task.topicId],
  )
  const focus = useMemo(() => ({ blockId: task.blockId }), [task.blockId])
  const outline = useMemo(() => ({
    focus,
    focusPresentation: 'content-only' as const,
    outdentBehavior: configuration.outdentBehavior,
  }), [configuration.outdentBehavior, focus])
  const currentEntry = opened.entries.find(entry => entry.kind === 'topic' && entry.id === task.topicId)
  const cardSource = currentEntry?.kind === 'topic' && currentEntry.topicType === 'regular'
    ? currentEntry.cardSource
    : undefined
  const reconcileCardTopics = useCallback((document: Parameters<NonNullable<ComponentProps<typeof Editor>['onDocumentChange']>>[0]) => {
    const result = opened.note.reconcileCardTopics({ document, topicId: task.topicId })
    if (result.detachedTopicId === null)
      return
    const detachedTopicId = result.detachedTopicId
    const toastId = toast.warning(
      <span>
        {t('cardTopicDetached')}
        {' '}
        <button
          type="button"
          onClick={() => {
            try {
              opened.note.resyncCardTopic(detachedTopicId)
              toast.dismiss(toastId)
            }
            catch (error) {
              toast.error(t('cardTopicResyncFailed', {
                message: errorMessage(error),
              }))
            }
          }}
        >
          {t('undoCardTopicDetach')}
        </button>
      </span>,
      { autoClose: 8_000 },
    )
  }, [opened.note, t, task.topicId])

  return (
    <div {...stylex.props(styles.editor)} data-todo-detail-editor="">
      <Editor
        adapters={adapters}
        blockHandles={false}
        cardPreviewDisabled
        cardTopic={cardSource !== undefined}
        focus={focus}
        layout="embedded"
        learningEnabled={configuration.learning.enabled}
        mode={EditorMode.Outline}
        platform={getPlatform()}
        shortcuts={configuration.shortcuts}
        onDocumentChange={reconcileCardTopics}
        outline={outline}
        taskDate={task.journalDate ?? undefined}
        topic={topic}
      />
    </div>
  )
}

export function TodoDetailEditor({ task }: { task: DesktopTodoTask }) {
  const { t } = useTranslation('todo')
  const loadNote = useCallback(() => desktopRequests.getNote({ noteId: task.noteId }), [task.noteId])
  const session = useEditorNoteSession<DesktopNote>({
    loadNote,
    noteId: task.noteId,
    topicId: task.topicId,
  })

  if (session.loadError) {
    return (
      <div {...stylex.props(styles.status, styles.statusError)} role="alert">
        {t('couldNotOpenTaskDetail', { message: session.loadError })}
      </div>
    )
  }
  if (!session.opened)
    return <div {...stylex.props(styles.status)} role="status">{t('openingTaskDetail')}</div>
  if (!('documentId' in session.opened.topic))
    throw new Error(`Todo ${task.blockId} belongs to a non-document Topic ${task.topicId}`)

  return (
    <>
      {session.validationError === null
        ? null
        : <div {...stylex.props(styles.alert)} role="alert">{session.validationError.message}</div>}
      {session.saveError === null
        ? null
        : <div {...stylex.props(styles.alert)} role="status">{t('couldNotSaveTaskDetail', { message: session.saveError })}</div>}
      <TodoDetailEditorLoaded
        applyExternal={session.applyExternal}
        opened={session.opened}
        task={task}
        topic={session.opened.topic}
      />
    </>
  )
}
