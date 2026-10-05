export interface EditorExportMark {
  attrs?: Readonly<Record<string, unknown>>
  type: string
}

export interface EditorExportNode {
  attrs?: Readonly<Record<string, unknown>>
  content?: readonly EditorExportNode[]
  marks?: readonly EditorExportMark[]
  text?: string
  type: string
}

export type EditorTaskStatus = 'doing' | 'done' | 'todo'

export interface EditorContentRenderer<T> {
  renderChildren: (children: readonly T[], node: EditorExportNode) => T
  renderMark: (mark: EditorExportMark, value: T, node: EditorExportNode) => T
  renderNode: (node: EditorExportNode, content: T) => T
  renderText: (text: string, node: EditorExportNode) => T
}

/**
 * The export seam walks the same serialized editor tree used by every format.
 * Adapters only decide syntax; recursive nesting and mark ordering stay here.
 */
export function renderEditorContent<T>(node: EditorExportNode, renderer: EditorContentRenderer<T>): T {
  const children = (node.content ?? []).map(child => renderEditorContent(child, renderer))
  const content = node.text === undefined
    ? renderer.renderChildren(children, node)
    : renderer.renderText(node.text, node)
  const marked = (node.marks ?? []).reduce(
    (value, mark) => renderer.renderMark(mark, value, node),
    content,
  )
  return renderer.renderNode(node, marked)
}

export function editorTaskStatus(node: EditorExportNode): EditorTaskStatus | null {
  if (node.attrs?.kind !== 'task')
    return null
  if (node.attrs.status === 'doing' || node.attrs.status === 'done' || node.attrs.status === 'todo')
    return node.attrs.status
  return node.attrs.checked === true ? 'done' : 'todo'
}
