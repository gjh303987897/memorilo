import { render } from 'katex'

export { renderKaTeXMathToString } from '../math'

export function renderKaTeXMathBlock(text: string, element: HTMLElement) {
  render(text, element, { displayMode: true, throwOnError: false, output: 'mathml' })
}

export function renderKaTeXMathInline(text: string, element: HTMLElement) {
  render(text, element, { displayMode: false, throwOnError: false, output: 'mathml' })
}
