import { renderToString } from 'katex'

export {
  convertLatexAstToTypstAst,
  convertLatexToTypst,
  parseLatexMath,
  renderTypstMathAst,
} from './math/latex-to-typst'
export type {
  LatexMathNode,
  LatexToTypstDiagnostic,
  LatexToTypstResult,
  TypstMathAst,
} from './math/latex-to-typst'

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
