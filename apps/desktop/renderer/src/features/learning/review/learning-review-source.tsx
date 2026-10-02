import type { DesktopReviewItem } from '@memorilo/desktop-api'
import type { CardSurfaceItemSelection, CardSurfaceSide } from '@memorilo/editor'
import type { EditorNote } from '@memorilo/editor/note'
import { CardSurface, demoEditorAdapters, Editor, EditorMode, projectEditorCards } from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { desktopRequests } from '../../../shared/desktop-requests'
import { errorMessage } from '../../../shared/error-message'
import { getPlatform } from '../../../shared/platform'

import { useEditorNoteSession } from '../../notes/editor/note-editor-session'
import { projectVisibleNoteEntries } from '../../notes/note-entry-tree'
import { useFlushNotePersistence } from '../../notes/persistence/note-persistence-hooks'
import { learningReviewSourceStyles as styles } from './learning-review-source.stylex'

const ImageOcclusionReview = lazy(async () => {
  const module = await import('./image-occlusion-review')
  return { default: module.ImageOcclusionReview }
})

export function LearningReviewSource({
  item,
  itemSelection,
  revealedItemBlockIds,
  showSource,
  side,
}: {
  item: DesktopReviewItem
  itemSelection?: CardSurfaceItemSelection
  revealedItemBlockIds?: readonly string[]
  showSource: boolean
  side: CardSurfaceSide
}) {
  const { t } = useTranslation('learning')
  if (item.card.kind === 'image-occlusion') {
    if (showSource)
      throw new Error('Image occlusion Cards do not support source context')
    return (
      <Suspense fallback={<div {...stylex.props(styles.sourceStatus)} role="status">{t('loadingSource')}</div>}>
        <ImageOcclusionReview card={item.card} side={side} />
      </Suspense>
    )
  }
  return (
    <EditorLearningReviewSource
      item={item}
      itemSelection={itemSelection}
      revealedItemBlockIds={revealedItemBlockIds}
      showSource={showSource}
      side={side}
    />
  )
}

function EditorLearningReviewSource({
  item,
  itemSelection,
  revealedItemBlockIds,
  showSource,
  side,
}: {
  item: DesktopReviewItem
  itemSelection?: CardSurfaceItemSelection
  revealedItemBlockIds?: readonly string[]
  showSource: boolean
  side: CardSurfaceSide
}) {
  const { t } = useTranslation('learning')
  const flush = useFlushNotePersistence()
  const [activeTopicId, setActiveTopicId] = useState(item.queue.topicId)
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<ReadonlySet<string>>(() => new Set())
  const [navigationError, setNavigationError] = useState<string | null>(null)
  if (item.card.kind === 'image-occlusion')
    throw new TypeError('Image occlusion Cards require the image occlusion review surface')
  const card = item.card
  const loadNote = useCallback(() => desktopRequests.getNote({ noteId: item.queue.noteId }), [item.queue.noteId])
  const resolveTopic = useCallback((note: EditorNote) => {
    const entry = note.getEntries().find((candidate): candidate is Extract<typeof candidate, { kind: 'topic' }> => (
      candidate.kind === 'topic' && candidate.id === activeTopicId
    ))
    if (!entry || entry.kind !== 'topic')
      throw new Error(`Note ${note.id} does not contain Learning Topic ${activeTopicId}`)
    if (entry.topicType === 'image-occlusion')
      throw new Error(`Review Topic ${entry.id} does not contain editor content`)
    if (entry.id !== item.queue.topicId || entry.topicType !== 'whiteboard')
      return note.getTopic(entry.id)
    const validation = note.getTopicValidationInput(entry.id)
    if (!('embeddedEditors' in validation))
      throw new Error(`WhiteboardTopic ${entry.id} is missing its Embedded Editors`)
    const matchingEditors = Object.values(validation.embeddedEditors)
      .filter(editor => projectEditorCards(editor.document).some(card => card.id === item.card.id))
    if (matchingEditors.length !== 1) {
      throw new Error(
        `Card ${item.card.id} must belong to exactly one Embedded Editor in WhiteboardTopic ${entry.id}`,
      )
    }
    const editor = matchingEditors[0]
    if (!editor)
      throw new Error(`Card ${item.card.id} has no Embedded Editor`)
    return note.getWhiteboardTopic(entry.id).getEmbeddedEditor(editor.editorId)
  }, [activeTopicId, item.card.id, item.queue.topicId])
  const source = useEditorNoteSession({
    loadNote,
    noteId: item.queue.noteId,
    resolveTopic,
    topicKey: activeTopicId,
  })
  if (source.loadError) {
    return (
      <div {...stylex.props(styles.sourceStatus, styles.sourceError)} role="alert">
        {t('loadSourceFailed', { message: source.loadError })}
      </div>
    )
  }
  if (!source.opened)
    return <div {...stylex.props(styles.sourceStatus)} role="status">{t('loadingSource')}</div>
  if (!('documentId' in source.opened.topic))
    throw new Error(`Review Topic ${item.queue.topicId} does not contain editor content`)

  const visibleEntries = projectVisibleNoteEntries(source.opened.entries, collapsedEntryIds)
  const switchTopic = async (topicId: string): Promise<void> => {
    try {
      await flush()
      setNavigationError(null)
      setActiveTopicId(topicId)
    }
    catch (error) {
      setNavigationError(errorMessage(error))
    }
  }

  return (
    <div {...stylex.props(styles.workspace)}>
      <div {...stylex.props(styles.canvas)}>
        {activeTopicId === item.queue.topicId
          ? (
              <CardSurface
                adapters={demoEditorAdapters}
                card={card}
                editable
                itemSelection={itemSelection}
                revealedItemBlockIds={revealedItemBlockIds}
                showSource={showSource}
                side={side}
                topic={source.opened.topic}
              />
            )
          : <Editor adapters={demoEditorAdapters} mode={EditorMode.Outline} platform={getPlatform()} topic={source.opened.topic} />}
      </div>
      <aside {...stylex.props(styles.structure)} aria-label={t('noteStructure')}>
        <div {...stylex.props(styles.structureHeader)}>{t('noteStructure')}</div>
        {navigationError ? <div {...stylex.props(styles.navigationError)} role="alert">{navigationError}</div> : null}
        <div {...stylex.props(styles.structureTree)}>
          {visibleEntries.map(({ depth, entry, hasChildren }) => {
            const active = entry.kind === 'topic' && entry.id === activeTopicId
            const sourceEntry = entry.id === item.queue.topicId
            const navigable = entry.kind === 'topic' && (entry.topicType === 'regular' || entry.topicType === 'book')
            return (
              <div key={entry.id} {...stylex.props(styles.structureRow)} style={{ paddingLeft: 8 + depth * 14 }}>
                {entry.kind === 'folder'
                  ? (
                      <button
                        {...stylex.props(styles.disclosure)}
                        aria-label={entry.name}
                        type="button"
                        onClick={() => setCollapsedEntryIds((current) => {
                          const next = new Set(current)
                          if (next.has(entry.id))
                            next.delete(entry.id)
                          else
                            next.add(entry.id)
                          return next
                        })}
                      >
                        {hasChildren && collapsedEntryIds.has(entry.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Folder size={14} />
                        <span>{entry.name}</span>
                      </button>
                    )
                  : (
                      <button
                        {...stylex.props(styles.topicButton, active && styles.topicButtonActive)}
                        disabled={!navigable}
                        type="button"
                        onClick={() => void switchTopic(entry.id)}
                      >
                        <FileText size={14} />
                        <span {...stylex.props(styles.topicLabel)}>{entry.title}</span>
                        {sourceEntry ? <span {...stylex.props(styles.sourceMarker)} aria-label={t('learningSource')} /> : null}
                      </button>
                    )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
