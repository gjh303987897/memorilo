import type { NodeJSON } from 'prosekit/core'
import type { Node as ProseMirrorNode } from 'prosekit/pm/model'
import type { EditorAdapters } from '../adapters/editor-adapters'
import type { CardReviewRuntime } from '../card/card-review-runtime'
import type { EditorShortcutConfiguration } from '../common/formatting-shortcuts'
import type { OutlineRuntime } from '../common/outline-runtime'
import type { EditorImageOcclusionIntegration } from '../image-occlusion/image-occlusion-model'
import type { EditorTopicRuntime } from '../note/editor-topic-runtime'
import type { EditorStore } from '../state/editor-store'
import { toError } from '@memorilo/effect-lifecycle'
import {
  LoroTreeEphemeralCursorPlugin,
  LoroTreeSyncPlugin,
  LoroTreeUndoPlugin,
  redo,
  undo,
} from '@memorilo/loro-prosemirror-tree'
import i18next from 'i18next'
import { defineBasicExtension } from 'prosekit/basic'
import {
  defineClipboardSerializer,
  defineCommands,
  defineDocChangeHandler,
  defineKeymap,
  definePlugin,
  isApple,
  Priority,
  union,
  withPriority,
} from 'prosekit/core'
import { defineCodeBlockShiki } from 'prosekit/extensions/code-block'
import { defineHorizontalRule } from 'prosekit/extensions/horizontal-rule'
import { defineImageUploadHandler } from 'prosekit/extensions/image'
import { defineMath } from 'prosekit/extensions/math'
import { definePlaceholder } from 'prosekit/extensions/placeholder'
import { defineReadonly } from 'prosekit/extensions/readonly'
import { defineCardExtension } from '../card/card-extension'
import { defineCardReviewExtension } from '../card/card-review-extension'
import { defineBlockIdExtension } from '../common/block-id-extension'
import { defineEditorKeymapExtension } from '../common/editor-keymap-extension'
import { defineFormattingShortcutGuards, defineFormattingShortcuts } from '../common/formatting-shortcuts'
import { defineOutlineKeymapExtension } from '../common/outline-keymap-extension'
import { defineOutlineViewExtension } from '../common/outline-view-extension'
import { defineTableKeymapExtension } from '../common/table-keymap-extension'
import { defineDocumentDropExtension } from '../document/document-drop-extension'
import { defineDocumentKeymapExtension } from '../document/document-keymap-extension'
import { renderKaTeXMathBlock, renderKaTeXMathInline } from '../sample/katex.ts'
import { uploadErrorAtom } from '../state/editor-atoms'
import { TagRuntime } from '../tag/tag-runtime'
import { defineCodeBlockView } from '../ui/code-block-view/index.ts'
import { defineImageView } from '../ui/image-view/index.ts'
import { defineTagView } from '../ui/tag-view/index.ts'
import { defineTaskListView } from '../ui/task-list-view/index.ts'
import { EditorUploadRuntime } from './editor-upload-runtime'
import { defineImageIdExtension } from './image-id-extension'
import { defineInlineMathInputRule } from './inline-math-input-rule'
import { defineMathKeymapExtension } from './math-keymap-extension'
import { createNetworkImagePaste } from './network-image-paste'
import { defineTag } from './tag-extension'

function defineTaskClipboardSerializer() {
  // Flat-list's native clipboard serializer bypasses the schema's custom task attributes.
  return withPriority(defineClipboardSerializer({
    serializeFragmentWrapper: serializeFragment => (fragment, ...args) => {
      const dom = serializeFragment(fragment, ...args)
      const targets = dom.querySelectorAll('li.prosemirror-flat-list')
      const lists: ProseMirrorNode[] = []
      fragment.descendants((node) => {
        if (node.type.name === 'list')
          lists.push(node)
      })
      lists.forEach((node, index) => {
        const target = targets.item(index)
        if (!target || node.attrs.kind !== 'task')
          return
        const output = node.type.spec.toDOM?.(node)
        if (!Array.isArray(output) || output[1] === null || typeof output[1] !== 'object' || Array.isArray(output[1]))
          return
        Object.entries(output[1]).forEach(([name, value]) => {
          if (!name.startsWith('data-task-'))
            return
          if (value === null || value === undefined)
            target.removeAttribute(name)
          else
            target.setAttribute(name, String(value))
        })
      })
      return dom
    },
  }), Priority.highest)
}

function defineLoroTree(topic: EditorTopicRuntime) {
  const keymap = {
    'Mod-z': undo,
    'Mod-Z': redo,
    ...(!isApple ? { 'Mod-y': redo } : {}),
  }
  return withPriority(union(
    defineKeymap(keymap),
    defineCommands({ redo: () => redo, undo: () => undo }),
    definePlugin(LoroTreeEphemeralCursorPlugin(topic.presence)),
    definePlugin(LoroTreeUndoPlugin({ doc: topic.doc, manageSelection: false, undoManager: topic.undoManager })),
    definePlugin(LoroTreeSyncPlugin(topic)),
  ), Priority.high)
}

export function createEditorExtension(
  adapters: EditorAdapters,
  store: EditorStore,
  outlineRuntime: OutlineRuntime,
  onDocumentChange?: (document: NodeJSON) => void,
  topic?: EditorTopicRuntime,
  readOnly = false,
  cardReviewRuntime?: CardReviewRuntime,
  imageOcclusion?: EditorImageOcclusionIntegration,
  learningEnabled = true,
  shortcuts?: EditorShortcutConfiguration,
  onSemanticAction?: (action: 'cloze' | 'extract') => void,
) {
  const uploadRuntime = new EditorUploadRuntime(adapters.uploadImage, store)
  const uploader = uploadRuntime.uploader
  const tagRuntime = new TagRuntime(adapters.tagStorage)
  const networkImagePaste = createNetworkImagePaste(adapters)

  const editorExtension = union(
    defineBasicExtension(),
    defineFormattingShortcutGuards(shortcuts),
    defineFormattingShortcuts(shortcuts),
    defineCardExtension({ authoringEnabled: learningEnabled, onSemanticAction, shortcuts }),
    ...(cardReviewRuntime ? [defineCardReviewExtension(cardReviewRuntime)] : []),
    withPriority(defineBlockIdExtension(), Priority.highest),
    withPriority(defineImageIdExtension(), Priority.highest),
    defineTableKeymapExtension(),
    defineEditorKeymapExtension(),
    defineMathKeymapExtension(),
    defineDocumentDropExtension(outlineRuntime),
    defineDocumentKeymapExtension(outlineRuntime),
    defineOutlineKeymapExtension(outlineRuntime),
    defineOutlineViewExtension(outlineRuntime),
    defineDocChangeHandler((view) => {
      onDocumentChange?.(view.state.doc.toJSON())
    }),
    // Resolve the placeholder at render time from the current locale so it stays
    // in sync with the active language, reading through the shared global i18next
    // instance without needing to recreate the editor on language change.
    definePlaceholder({
      placeholder: () => i18next.t('ui.placeholder', { ns: 'editor' }),
    }),
    defineTag(tagRuntime),
    defineMath({
      renderMathBlock: renderKaTeXMathBlock,
      renderMathInline: renderKaTeXMathInline,
    }),
    defineInlineMathInputRule(),
    defineCodeBlockShiki(),
    defineHorizontalRule(),
    defineCodeBlockView(),
    defineImageView(imageOcclusion),
    defineTagView(tagRuntime),
    defineTaskListView(adapters.taskActions),
    defineTaskClipboardSerializer(),
    defineImageUploadHandler({
      uploader,
      onError: ({ error }) => {
        if (uploadRuntime.closed)
          return
        const message = toError(error).message
        store.set(uploadErrorAtom, message)
      },
    }),
    networkImagePaste.extension,
    ...(readOnly ? [defineReadonly()] : []),
  )

  return {
    extension: topic
      ? union(editorExtension, defineLoroTree(topic))
      : editorExtension,
    networkImagePasteRuntime: networkImagePaste.runtime,
    tagRuntime,
    uploadRuntime,
    uploader,
  }
}

export type EditorExtension = ReturnType<typeof createEditorExtension>['extension']
