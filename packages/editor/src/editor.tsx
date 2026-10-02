import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from './adapters/editor-adapters'
import type { CardReviewOptions } from './card/card-review-runtime'
import type { EditorCardIntegration } from './card/card-sync'
import type { EditorModeValue } from './common/editor-mode'
import type { EditorPlatform } from './common/editor-platform'
import type { EditorShortcutConfiguration } from './common/formatting-shortcuts'
import type { OutlineOptions } from './common/outline-runtime'
import type { EditorImageOcclusionIntegration } from './image-occlusion/image-occlusion-model'
import type { EditorTopicDocument } from './note/editor-note'
import * as stylex from '@stylexjs/stylex'
import { Provider } from 'jotai'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorMode, editorModeName } from './common/editor-mode'
import { createEditorSession } from './common/editor-session'
import { editorShellStyles } from './common/editor-shell.stylex'
import { resolveOutlineFocusTarget } from './common/outline-runtime'
import { useEditorTopicMode } from './note/use-editor-topic-mode'
import { OutlineEditor } from './outline/outline-editor'
import { EditorModePicker } from './ui/editor-mode-picker'
import 'prosekit/basic/style.css'
import 'prosekit/basic/typography.css'
import 'katex/dist/katex.min.css'
import './common/editor-content.stylex'
import './card/card-content.stylex'
import './card/card-review-content.stylex'

const DocumentEditor = lazy(async () => {
  const module = await import('./document/document-editor')
  return { default: module.DocumentEditor }
})

interface EditorBaseProps {
  adapters: EditorAdapters
  cardPreviewDisabled?: boolean
  cardTopic?: boolean
  cardReview?: CardReviewOptions
  cards?: EditorCardIntegration
  blockHandles?: boolean
  focus?: EditorFocusTarget
  imageOcclusion?: EditorImageOcclusionIntegration
  learningEnabled?: boolean
  shortcuts?: EditorShortcutConfiguration
  mode?: EditorModeValue
  onDocumentChange?: (document: NodeJSON) => void
  onSemanticAction?: (action: 'cloze' | 'extract') => void
  outline?: OutlineOptions
  platform?: EditorPlatform
  readOnly?: boolean
  /** Planning date used by tasks without an explicit due date, such as Journal tasks. */
  taskDate?: string
}

export interface EditorFocusTarget {
  blockId: string
}

export interface EditorProps extends EditorBaseProps {
  /** Standalone editors own vertical scrolling; embedded editors grow inside an outer scroller. */
  layout?: EditorLayout
  topic: EditorTopicDocument
}

export type EditorLayout = 'embedded' | 'standalone'

export function Editor(props: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onDocumentChangeRef = useRef(props.onDocumentChange)
  const onSemanticActionRef = useRef(props.onSemanticAction)
  const onCardSyncErrorRef = useRef(props.cards?.onSyncError)
  const imageOcclusionRef = useRef(props.imageOcclusion)
  const learningEnabled = props.learningEnabled ?? true
  const controlledFocusProvided = Boolean(props.outline && Object.prototype.hasOwnProperty.call(props.outline, 'focus'))
  const controlledFocus = props.outline?.focus
  const controlledOutdentBehaviorProvided = Boolean(
    props.outline && Object.prototype.hasOwnProperty.call(props.outline, 'outdentBehavior'),
  )
  const controlledOutdentBehavior = props.outline?.outdentBehavior
  if (controlledOutdentBehaviorProvided && controlledOutdentBehavior === undefined)
    throw new TypeError('Controlled Outline outdent behavior cannot be undefined')
  const initialOutlineOptionsRef = useRef<OutlineOptions | undefined>(props.outline
    ? {
        defaultFocus: controlledFocusProvided ? controlledFocus : props.outline.defaultFocus,
        defaultOutdentBehavior: controlledOutdentBehaviorProvided
          ? controlledOutdentBehavior
          : props.outline.defaultOutdentBehavior,
      }
    : undefined)
  const initialCardReviewRef = useRef(props.cardReview)
  onDocumentChangeRef.current = props.onDocumentChange
  onSemanticActionRef.current = props.onSemanticAction
  onCardSyncErrorRef.current = props.cards?.onSyncError
  imageOcclusionRef.current = props.imageOcclusion
  const cardRepository = props.cards?.repository
  const cardIntegration = useMemo<EditorCardIntegration | undefined>(() => cardRepository
    ? {
        onSyncError: (input) => {
          const handler = onCardSyncErrorRef.current
          if (!handler)
            throw new Error('Editor Card integration requires an onSyncError handler')
          handler(input)
        },
        repository: cardRepository,
      }
    : undefined, [cardRepository])
  const imageOcclusionAvailable = props.imageOcclusion !== undefined
  const imageOcclusion = useMemo<EditorImageOcclusionIntegration | undefined>(() => imageOcclusionAvailable
    ? {
        getState: (imageId) => {
          const integration = imageOcclusionRef.current
          if (!integration)
            throw new Error('Image occlusion integration is unavailable')
          return integration.getState(imageId)
        },
        open: (input) => {
          const integration = imageOcclusionRef.current
          if (!integration)
            throw new Error('Image occlusion integration is unavailable')
          return integration.open(input)
        },
        subscribe: (listener) => {
          const integration = imageOcclusionRef.current
          if (!integration)
            throw new Error('Image occlusion integration is unavailable')
          return integration.subscribe(listener)
        },
      }
    : undefined, [imageOcclusionAvailable])
  const storedMode = useEditorTopicMode(props.topic)
  const mode = props.mode ?? storedMode
  const layout = props.layout ?? 'standalone'
  if (layout !== 'standalone' && layout !== 'embedded')
    throw new TypeError(`Unknown Editor layout: ${String(layout)}`)
  const embedded = layout === 'embedded'
  const { t } = useTranslation('editor')
  const session = useMemo(() => createEditorSession({
    adapters: props.adapters,
    cardReview: initialCardReviewRef.current,
    cards: cardIntegration,
    imageOcclusion,
    learningEnabled,
    onDocumentChange: document => onDocumentChangeRef.current?.(document),
    onSemanticAction: (action) => {
      const handler = onSemanticActionRef.current
      if (handler)
        handler(action)
    },
    outline: initialOutlineOptionsRef.current,
    readOnly: props.readOnly === true,
    shortcuts: props.shortcuts,
    topicDocument: props.topic,
    // The underlying Note topic is stable by ID; ignore wrapper-object changes
    // caused by persistence receipts so asynchronous uploads retain their view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [props.adapters, cardIntegration, imageOcclusion, learningEnabled, props.readOnly, props.shortcuts, props.topic.documentId, props.topic.noteId])
  const empty = useSyncExternalStore(
    session.emptyState.subscribe,
    session.emptyState.getSnapshot,
    session.emptyState.getSnapshot,
  )

  useEffect(() => {
    return () => {
      void session.close().then(
        () => undefined,
        error => console.error('Failed to close Editor session', error),
      )
    }
  }, [session])

  useLayoutEffect(() => {
    if (!controlledFocusProvided)
      return
    const blockId = controlledFocus ? resolveOutlineFocusTarget(session.editor.getDocJSON(), controlledFocus) : null
    session.outlineRuntime.setFocus(blockId)
  }, [controlledFocus, controlledFocusProvided, session])

  useLayoutEffect(() => {
    if (!props.cardReview || !session.learningEnabled)
      return
    if (!session.cardReviewRuntime)
      throw new Error('Controlled Card review requires a Card review Editor session')
    session.cardReviewRuntime.setOptions(props.cardReview)
  }, [props.cardReview, session])

  useEffect(() => {
    if (!controlledOutdentBehaviorProvided)
      return
    session.outlineRuntime.setOutdentBehavior(controlledOutdentBehavior!)
  }, [controlledOutdentBehavior, controlledOutdentBehaviorProvided, session])

  useLayoutEffect(() => {
    session.outlineRuntime.setActive(mode === EditorMode.Outline)
  }, [mode, session])

  return (
    <Provider store={session.store}>
      <div
        ref={rootRef}
        {...stylex.props(
          editorShellStyles.root,
          embedded && editorShellStyles.rootEmbedded,
          embedded && empty && editorShellStyles.rootEmbeddedEmpty,
        )}
        data-editor-layout={layout}
        data-editor-learning-disabled={!session.learningEnabled ? '' : undefined}
        data-editor-mode={editorModeName(mode)}
        data-editor-outline-focus-presentation={props.outline?.focusPresentation}
        data-editor-readonly={props.readOnly ? '' : undefined}
        data-editor-card-preview-disabled={props.cardPreviewDisabled ? '' : undefined}
        data-editor-card-topic={props.cardTopic ? '' : undefined}
      >
        <Suspense fallback={<div {...stylex.props(editorShellStyles.loading)} role="status">{t('ui.loadingEditorMode')}</div>}>
          <DocumentEditor
            embedded={embedded}
            blockHandles={props.blockHandles}
            focusBlockId={props.focus?.blockId}
            mode={mode}
            modePicker={empty && props.readOnly !== true
              ? onActivate => (
                <EditorModePicker
                  session={session}
                  onActivate={onActivate}
                />
              )
              : undefined}
            platform={props.platform}
            readOnly={props.readOnly === true}
            session={session}
            taskDate={props.taskDate}
          >
            {mode === EditorMode.Outline
              ? (
                  <Suspense fallback={<div {...stylex.props(editorShellStyles.loading)} role="status">{t('ui.loadingOutlineMode')}</div>}>
                    <OutlineEditor options={props.outline} readOnly={props.readOnly === true} rootRef={rootRef} session={session} />
                  </Suspense>
                )
              : null}
          </DocumentEditor>
        </Suspense>
      </div>
    </Provider>
  )
}
