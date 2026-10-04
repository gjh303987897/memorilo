import type {
  EditorContentRenderer,
  EditorExportMark,
  EditorExportNode,
  EditorTaskStatus,
} from './editor-content'
import { convertLatexToTypst } from '../math/latex-to-typst'
import { editorTaskStatus, renderEditorContent } from './editor-content'

export interface TypstContentRendererOptions {
  inlineAsset?: (source: string) => string
  nodeRenderers?: Readonly<Record<string, (node: EditorExportNode, content: string) => string | undefined>>
}

export const typstTaskPrelude = `#let task-marker(status) = {
  if status == "done" {
    box(
      width: 0.95em,
      height: 0.95em,
      fill: rgb("#4f46e5"),
      radius: 50%,
      baseline: -0.1em,
      inset: 0pt,
      align(center + horizon)[#text(fill: white, size: 0.7em)[✓]],
    )
  } else if status == "doing" {
    box(
      width: 0.95em,
      height: 0.95em,
      stroke: 1pt + rgb("#4f46e5"),
      radius: 50%,
      baseline: -0.1em,
      inset: 0pt,
      align(center + horizon)[#circle(radius: 0.2em, fill: rgb("#4f46e5"))],
    )
  } else {
    box(width: 0.95em, height: 0.95em, stroke: 0.8pt + rgb("#9ca3af"), radius: 50%, baseline: -0.1em)
  }
}
#let task-item(status, body) = {
  let rendered = if status == "done" { strike(body) } else { body }
  grid(columns: (1.2em, 1fr), gutter: 0.5em, task-marker(status), rendered)
}
`

export function renderTypstTask(status: EditorTaskStatus, content: string): string {
  return `#task-item("${status}", [${content.replaceAll('\n\n', ' ').trim()}])\n`
}

function escapeTypst(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('#', '\\#')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function escapeTypstString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')
}

function mathSource(node: EditorExportNode): string {
  return String(node.attrs?.source ?? node.text ?? (node.content ?? []).map(child => child.text ?? '').join(''))
}

function safeExportHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0)
    return null
  try {
    const url = new URL(value, 'https://memorilo-export.invalid')
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:' && url.protocol !== 'tel:')
      return null
    return value
  }
  catch {
    return null
  }
}

function createTypstRenderer(options: TypstContentRendererOptions): EditorContentRenderer<string> {
  const inlineAsset = options.inlineAsset ?? (() => '')
  const renderers = options.nodeRenderers ?? {}
  return {
    renderChildren: children => children.join(''),
    renderMark(mark: EditorExportMark, value: string): string {
      switch (mark.type) {
        case 'bold': return `*${value}*`
        case 'italic': return `_${value}_`
        case 'underline': return `#underline[${value}]`
        case 'strike': return `#strike[${value}]`
        case 'code': return `#raw[${value}]`
        case 'inlineHighlight': return `#highlight[${value}]`
        case 'link': {
          const href = safeExportHref(mark.attrs?.href)
          return href === null ? value : `#link("${escapeTypstString(href)}")[${value}]`
        }
        case 'cloze': return value
        default: return value
      }
    },
    renderNode(node: EditorExportNode, content: string): string {
      const custom = renderers[node.type]?.(node, content)
      if (custom !== undefined)
        return custom
      switch (node.type) {
        case 'doc': return content
        case 'paragraph': return `${content}\n\n`
        case 'heading': return `= ${content}\n\n`
        case 'blockquote': return `#quote[${content}]\n\n`
        case 'codeBlock': return `#raw(block: true)[${content}]\n\n`
        case 'horizontalRule': return '#line(length: 100%)\n\n'
        case 'bulletList':
        case 'orderedList': return content
        case 'listItem':
        case 'list': {
          const status = editorTaskStatus(node)
          if (status !== null)
            return renderTypstTask(status, content)
          return `- ${content.replaceAll('\n\n', ' ')}\n`
        }
        case 'hardBreak': return '\\ '
        case 'image': {
          const source = typeof node.attrs?.src === 'string' ? inlineAsset(node.attrs.src) : ''
          return source.length === 0 ? '[image unavailable]\n\n' : `#image("${escapeTypstString(source)}", width: 100%)\n\n`
        }
        case 'mathInline':
        case 'mathBlock': {
          const source = mathSource(node)
          const converted = convertLatexToTypst(source)
          if (converted.fallback)
            return `${converted.source}\n\n`
          const expression = `$ ${converted.source} $`
          return node.type === 'mathBlock'
            ? `#align(center, ${expression})\n\n`
            : `${expression} `
        }
        case 'tag': return `#text[#${escapeTypst(String(node.attrs?.label ?? ''))}]`
        case 'cardDelimiter': return '↔'
        default: return content.length > 0 ? content : escapeTypst(node.text ?? '')
      }
    },
    renderText: text => escapeTypst(text),
  }
}

export function renderTypstContent(node: EditorExportNode, options: TypstContentRendererOptions = {}): string {
  return renderEditorContent(node, createTypstRenderer(options))
}
