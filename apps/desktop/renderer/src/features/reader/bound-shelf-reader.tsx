import type { DesktopBookTopicReadingContext, DesktopNoteExternalUpdate } from '@memorilo/desktop-api'
import type {
  ReaderAnnotation,
  ReaderAnnotationTopicCreateInput,
  ReaderImageOcclusionOverlay,
  ReaderPosition,
  ReaderSource,
} from '@memorilo/editor/reader'
import type { ReaderCaptureRegion } from './reader-capture'
import { createEditorNote, Editor } from '@memorilo/editor'
import { WindowReader } from '@memorilo/editor/reader'
import { PanelRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesktopConfiguration } from '../../shared/configuration'

import { desktopRequests } from '../../shared/desktop-requests'
import { getPlatform } from '../../shared/platform'
import { desktopEditorAdapters } from '../notes/editor/note-editor-session'
import { useNoteFavorite } from '../notes/note-favorite'
import { NoteInspectorContent } from '../notes/note-inspector'
import { NoteInspectorActions } from '../notes/note-inspector-actions'
import { useNoteInspectorEntries } from '../notes/note-inspector-state'
import { applyExternalNoteUpdate } from '../notes/note-runtime'
import { useFlushNotePersistence, useNotePersistence } from '../notes/persistence/note-persistence-hooks'
import { boundReaderPresentation } from './bound-reader-presentation'
import {
  prepareReaderAnnotationTopicsForDeletion,
  readerAnnotationDependents,
  reconciledReaderAnnotations,
} from './reader-annotation-bindings'
import { createReaderAnnotationTopic } from './reader-annotation-topics'
import { captureReaderAnnotationRegion } from './reader-capture'

export function BoundShelfReader({
  context,
  initialAnnotationId,
  initialPosition,
  onOpenTopic,
  source,
}: {
  context: DesktopBookTopicReadingContext
  initialAnnotationId?: string
  initialPosition: ReaderPosition | null
  onOpenTopic: (topicId: string) => Promise<void>
  source: ReaderSource
}) {
  const configuration = useDesktopConfiguration()
  const { t } = useTranslation('editor')
  const { enqueue, getPendingChanges } = useNotePersistence(context.note.id)
  const flushNotePersistence = useFlushNotePersistence()
  const { collapsedEntryIds, toggleEntry } = useNoteInspectorEntries(context.note.id)
  const { favorite, favoritePending, toggleFavorite } = useNoteFavorite(context.note)
  const note = useMemo(() => {
    const restored = createEditorNote({
      id: context.note.id,
      snapshot: context.note.snapshot,
      title: context.note.title,
    })
    getPendingChanges().forEach(change => restored.importUpdates(change.update))
    return restored
  }, [context.note.id, context.note.snapshot, context.note.title, getPendingChanges])
  const bookTopic = useMemo(() => note.getBookTopic(context.topicId), [context.topicId, note])
  const applyTaskExternal = useCallback(
    (external: DesktopNoteExternalUpdate) => applyExternalNoteUpdate(note, external) !== null,
    [note],
  )
  const editorAdapters = useMemo(
    () => desktopEditorAdapters(configuration.networkImagePasteBehavior, {
      applyExternal: applyTaskExternal,
      flush: flushNotePersistence,
      noteId: context.note.id,
      topicId: context.topicId,
    }),
    [applyTaskExternal, configuration.networkImagePasteBehavior, context.note.id, context.topicId, flushNotePersistence],
  )
  const initialReadingState = useRef(bookTopic.getReadingState()).current
  const initialReaderPosition = useRef(initialReadingState.position ?? initialPosition).current
  const initialAnnotations = useRef(reconciledReaderAnnotations(
    note,
    context.topicId,
    initialReadingState.annotations,
  )).current
  const initialReconciliationAppliedRef = useRef(false)
  const [annotations, setAnnotations] = useState(initialAnnotations)
  const [entries, setEntries] = useState(() => note.getEntries())
  const positionRef = useRef(initialReadingState.position)
  const annotationsRef = useRef(initialAnnotations)
  const presentation = boundReaderPresentation({
    bookTitle: context.book.book.title,
    noteTitle: context.note.title,
    topicTitle: context.topicTitle,
  })

  const syncNoteProjection = useCallback(() => {
    const next = bookTopic.getReadingState()
    const nextAnnotations = reconciledReaderAnnotations(note, context.topicId, next.annotations)
    positionRef.current = next.position
    annotationsRef.current = nextAnnotations
    setAnnotations(nextAnnotations)
    setEntries(note.getEntries())
    if (nextAnnotations !== next.annotations)
      bookTopic.setAnnotations(nextAnnotations)
  }, [bookTopic, context.topicId, note])
  const imageOcclusionOverlays = useMemo<readonly ReaderImageOcclusionOverlay[]>(() => {
    if (!configuration.learning.enabled)
      return []
    return annotations.flatMap((annotation) => {
      if (annotation.anchors[0].type !== 'region')
        return []
      const topic = note.findImageOcclusionTopic({
        annotationId: annotation.id,
        kind: 'reader-region',
        topicId: context.topicId,
      })
      if (!topic)
        return []
      const state = topic.getState()
      return [{
        annotationId: annotation.id,
        image: state.image,
        shapes: state.shapes,
      }]
    })
  }, [annotations, configuration.learning.enabled, context.topicId, note])
  const handleNoteChange = useCallback((change: { noteId: string, update: Uint8Array }) => {
    enqueue(change)
    syncNoteProjection()
  }, [enqueue, syncNoteProjection])

  useEffect(() => {
    const unsubscribeLocal = note.subscribe(handleNoteChange)
    const unsubscribeExternal = window.desktop.subscribeNoteUpdates((update) => {
      if (update.noteId !== note.id)
        return
      note.importUpdates(update.update)
      syncNoteProjection()
    })
    if (initialAnnotations !== initialReadingState.annotations && !initialReconciliationAppliedRef.current) {
      initialReconciliationAppliedRef.current = true
      bookTopic.setAnnotations(initialAnnotations)
    }
    if (initialReadingState.position === null && initialReaderPosition !== null)
      bookTopic.setPosition(initialReaderPosition)
    return () => {
      unsubscribeLocal()
      unsubscribeExternal()
    }
  }, [
    bookTopic,
    handleNoteChange,
    initialAnnotations,
    initialReaderPosition,
    initialReadingState.annotations,
    initialReadingState.position,
    note,
    syncNoteProjection,
  ])

  const onPositionChange = useCallback((position: ReaderPosition) => {
    if (JSON.stringify(position) === JSON.stringify(positionRef.current))
      return
    bookTopic.setPosition(position)
  }, [bookTopic])
  const onAnnotationsChange = useCallback((nextAnnotations: readonly ReaderAnnotation[]) => {
    if (JSON.stringify(nextAnnotations) === JSON.stringify(annotationsRef.current))
      return
    bookTopic.setAnnotations(nextAnnotations)
  }, [bookTopic])
  const captureAnnotationRegion = useCallback((region: ReaderCaptureRegion) => captureReaderAnnotationRegion({
    captureReaderRegion: desktopRequests.captureReaderRegion,
    region,
  }), [])
  const createAnnotationTopic = useCallback((input: ReaderAnnotationTopicCreateInput, signal: AbortSignal) => {
    return createReaderAnnotationTopic({
      bookTopicId: context.topicId,
      captureReaderRegion: captureAnnotationRegion,
      createTopic: note.createTopic,
      input,
      saveImage: desktopRequests.saveImage,
      signal,
      viewport: { height: window.innerHeight, width: window.innerWidth },
    })
  }, [captureAnnotationRegion, context.topicId, note])
  const getAnnotationDependents = useCallback(
    (annotation: ReaderAnnotation) => readerAnnotationDependents(note, context.topicId, annotation),
    [context.topicId, note],
  )
  const prepareAnnotationDeletion = useCallback(async (annotation: ReaderAnnotation) => {
    prepareReaderAnnotationTopicsForDeletion(note, context.topicId, annotation)
  }, [context.topicId, note])
  const openImageOcclusion = useCallback(async (
    input: ReaderAnnotationTopicCreateInput,
    signal: AbortSignal,
  ) => {
    if (!configuration.learning.enabled)
      throw new Error('Learning features are disabled')
    const { openReaderRegionImageOcclusion, readReaderImageSize } = await import('./reader-image-occlusion')
    const topicId = await openReaderRegionImageOcclusion({
      bookTopicId: context.topicId,
      captureReaderRegion: captureAnnotationRegion,
      input,
      note,
      readImageSize: readReaderImageSize,
      saveImage: desktopRequests.saveImage,
      signal,
      title: t('imageOcclusion.defaultTitle'),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    })
    signal.throwIfAborted()
    await onOpenTopic(topicId)
  }, [captureAnnotationRegion, configuration.learning.enabled, context.topicId, note, onOpenTopic, t])
  return (
    <WindowReader
      annotationCopyBookTitle={presentation.annotationCopyBookTitle}
      annotationCopyFormat={configuration.readerAnnotationCopyFormat}
      annotationEditingEnabled
      annotations={annotations}
      arrowKeyPageTurning={configuration.readerArrowKeyPageTurning}
      imageOcclusionOverlays={configuration.learning.enabled ? imageOcclusionOverlays : undefined}
      auxiliarySidebar={{
        content: (
          <NoteInspectorContent
            collapsedEntryIds={collapsedEntryIds}
            currentTopicId={context.topicId}
            entries={entries}
            learningEnabled={configuration.learning.enabled}
            note={note}
            noteId={note.id}
            onToggleEntry={toggleEntry}
            showTitle={false}
          />
        ),
        icon: <PanelRight aria-hidden="true" size={14} strokeWidth={1.8} />,
        label: t('noteTitle'),
      }}
      initialPosition={initialReaderPosition}
      initialPresentationMode={configuration.readerEpubPresentationMode}
      pageMode={configuration.readerPageMode}
      initialAnnotationId={initialAnnotationId}
      onCreateAnnotationTopic={createAnnotationTopic}
      onPrepareAnnotationDeletion={prepareAnnotationDeletion}
      onGetAnnotationDependents={getAnnotationDependents}
      onOpenReaderRegionImageOcclusion={configuration.learning.enabled ? openImageOcclusion : undefined}
      renderAnnotationEditor={({ annotation, readOnly }) => {
        if (!annotation.annotationTopicId)
          throw new Error(`Reader annotation ${annotation.id} has no Topic Editor binding`)
        return (
          <Editor
            adapters={editorAdapters}
            layout="embedded"
            learningEnabled={configuration.learning.enabled}
            platform={getPlatform()}
            shortcuts={configuration.shortcuts}
            outline={{ outdentBehavior: configuration.outdentBehavior }}
            readOnly={readOnly}
            topic={note.getTopic(annotation.annotationTopicId)}
          />
        )
      }}
      sidebarActions={({ active, toggle }) => (
        <NoteInspectorActions
          favorite={favorite}
          favoritePending={favoritePending}
          inspectorVisible={active}
          onToggleFavorite={toggleFavorite}
          onToggleInspector={toggle}
        />
      )}
      source={source}
      title={presentation.title}
      onAnnotationsChange={onAnnotationsChange}
      onPositionChange={onPositionChange}
    />
  )
}
