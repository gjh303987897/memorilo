import { Fragment } from 'prosekit/pm/model'
import { describe, expect, it } from 'vitest'
import { topicProseMirrorSchema } from '../schema/topic-prosemirror-schema'
import { renderEditorContent } from './editor-content'
import { renderTypstContent, typstTaskPrelude } from './typst-content'

function registeredNode(type: string, depth = 0): ReturnType<typeof topicProseMirrorSchema.nodes[string]['createAndFill']> {
  const nodeType = topicProseMirrorSchema.nodes[type]
  if (nodeType === undefined)
    return null
  if (type === 'text')
    return topicProseMirrorSchema.text('sample')
  const childType = depth < 8 ? nodeType.contentMatch.defaultType : null
  const child = childType === null || childType === undefined ? null : registeredNode(childType.name, depth + 1)
  return nodeType.createAndFill(undefined, child === null ? undefined : Fragment.from(child))
}

describe('editor export rendering', () => {
  it('keeps nested nodes and marks in one renderer seam', () => {
    const source = renderTypstContent({
      type: 'doc',
      content: [{
        type: 'component',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            marks: [{ type: 'bold' }],
            text: 'Nested',
          }],
        }],
      }],
    }, {
      nodeRenderers: {
        component: (_node, content) => `#box[${content}]\n\n`,
      },
    })

    expect(source).toBe('#box[*Nested*\n\n]\n\n')
  })

  it('renders task nodes with native Typst markers', () => {
    const source = `${typstTaskPrelude}${renderTypstContent({
      type: 'doc',
      content: [{
        attrs: { kind: 'task', status: 'done' },
        type: 'list',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Finished' }],
        }],
      }],
    })}`

    expect(source).toContain('#task-item("done", [Finished])')
    expect(source).not.toMatch(/- [☐◐☑]/u)
  })

  it('supports a generic renderer for display-compatible projections', () => {
    const output = renderEditorContent({
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello' }],
    }, {
      renderChildren: children => children.join(''),
      renderMark: (_mark, value) => value,
      renderNode: (node, content) => node.type === 'paragraph' ? `<p>${content}</p>` : content,
      renderText: text => text,
    })

    expect(output).toBe('<p>hello</p>')
  })

  it('keeps plain text math nodes from becoming unknown Typst variables', () => {
    const source = renderTypstContent({
      attrs: { source: 'fasdfasfd' },
      type: 'mathInline',
    })

    expect(source).toContain('#text("fasdfasfd")')
    expect(source).not.toContain('$ fasdfasfd $')
  })

  it('uses the LaTeX AST converter for regular math nodes', () => {
    const source = renderTypstContent({
      attrs: { source: String.raw`\frac{a}{\sqrt{x}}` },
      type: 'mathInline',
    })

    expect(source).toContain('$ frac(a, sqrt(x)) $')
  })

  it('reports fallback use without changing fallback output', () => {
    const futureMarkNode = {
      content: [{
        marks: [{ type: 'futureMark' }],
        text: 'sample',
        type: 'text',
      }],
      type: 'futureNode',
    }
    const futureNode = {
      content: [{ text: 'sample', type: 'text' }],
      type: 'futureNode',
    }

    expect(renderTypstContent(futureMarkNode)).toBe('sample')
    expect(renderTypstContent(futureNode)).toBe('sample')
    expect(() => renderTypstContent(futureMarkNode, { fallbackPolicy: 'throw' }))
      .toThrow('Typst renderer has no handler for mark "futureMark"')
    expect(() => renderTypstContent(futureNode, { fallbackPolicy: 'throw' }))
      .toThrow('Typst renderer has no handler for node "futureNode"')
  })

  it('does not fall back for any node or mark currently registered in the editor schema', () => {
    const unhandledNodes: string[] = []
    const unhandledMarks: string[] = []
    for (const type of Object.keys(topicProseMirrorSchema.nodes)) {
      const node = registeredNode(type)
      if (node === null || node === undefined) {
        unhandledNodes.push(`${type}: schema could not create a representative node`)
        continue
      }
      try {
        renderTypstContent(node.toJSON(), { fallbackPolicy: 'throw' })
      }
      catch {
        unhandledNodes.push(type)
      }
    }

    const markAttrs: Readonly<Record<string, unknown>> = {
      anchorKind: 'rich-content',
      cardId: 'test-card',
      color: 'yellow',
      definitionId: 'test-definition',
      groupId: 'test-group',
      href: 'https://example.test/',
      id: 'test-highlight',
    }
    for (const type of Object.keys(topicProseMirrorSchema.marks)) {
      try {
        renderTypstContent({
          marks: [{ attrs: markAttrs, type }],
          text: 'sample',
          type: 'text',
        }, { fallbackPolicy: 'throw' })
      }
      catch {
        unhandledMarks.push(type)
      }
    }

    expect(unhandledNodes).toEqual([])
    expect(unhandledMarks).toEqual([])
  })
})
