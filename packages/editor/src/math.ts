import { renderToString } from 'katex'

/**
 * Serialize math without a DOM so document exports share the editor's
 * MathML configuration.
 */
export function renderKaTeXMathToString(text: string, displayMode: boolean): string {
  return renderToString(text, {
    displayMode,
    output: 'mathml',
    throwOnError: false,
  })
}
