import { describe, expect, it } from 'vitest'
import { renderEditorContent } from './editor-content'
import { renderTypstContent, typstTaskPrelude } from './typst-content'

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
})
