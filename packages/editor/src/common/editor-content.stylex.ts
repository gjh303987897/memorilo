import inject from '@stylexjs/stylex/lib/stylex-inject'

const editorContentRules = [
  '[data-editor-content].ProseMirror:focus { outline: none; }',
  '[data-editor-content].ProseMirror:not(:focus) .prosekit-placeholder::before { content: none; }',
  '[data-editor-content].ProseMirror :is(h1, h2, h3, h4, h5, h6) { letter-spacing: 0; }',
  '[data-editor-content].ProseMirror h1 { margin-top: 1em; margin-bottom: 0.4em; font-size: 30px; line-height: 1.2; }',
  '[data-editor-content].ProseMirror h2 { margin-top: 1.15em; margin-bottom: 0.35em; font-size: 23px; line-height: 1.3; }',
  '[data-editor-content].ProseMirror h3 { margin-top: 1.1em; margin-bottom: 0.3em; line-height: 1.35; }',
  '[data-editor-content].ProseMirror :is(h4, h5, h6) { margin-top: 1em; margin-bottom: 0.25em; line-height: 1.4; }',
  '[data-editor-content].ProseMirror > h1:first-child { margin-top: 0; }',
  '[data-editor-content].ProseMirror blockquote { margin-left: 0; padding-left: 18px; color: #52605b; }',
  '[data-editor-content].ProseMirror table { width: 100%; border-collapse: collapse; table-layout: fixed; }',
  '[data-editor-content].ProseMirror :is(td, th) { border: 1px solid #cfd5da; padding: 8px 10px; vertical-align: top; }',
  '[data-editor-content].ProseMirror code { border-radius: 3px; padding: 2px 4px; background: #eef1f3; color: #8d2d42; }',
  '[data-editor-content].ProseMirror .prosemirror-math-block .prosemirror-math-display, [data-editor-content].ProseMirror .prosemirror-math-block .prosemirror-math-display > math { text-align: center; }',
]

for (const rule of editorContentRules)
  inject({ ltr: rule, priority: 1 })
