import { render } from 'katex'

export { renderKaTeXMathToString } from '../math'

export function renderKaTeXMathBlock(text: string, element: HTMLElement) {
  render(text, element, { displayMode: true, throwOnError: false, output: 'mathml' })
  element.style.textAlign = 'center'
  const math = element.querySelector<HTMLElement>('math')
  if (math) {
    // MathML defaults to a full-width block in Chromium, so shrink it before auto margins can center the formula.
    math.style.display = 'block'
    math.style.width = 'max-content'
    math.style.marginInline = 'auto'
    math.style.textAlign = 'center'
  }
}

export function renderKaTeXMathInline(text: string, element: HTMLElement) {
  render(text, element, { displayMode: false, throwOnError: false, output: 'mathml' })
}
