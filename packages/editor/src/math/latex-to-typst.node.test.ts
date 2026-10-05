import { describe, expect, it } from 'vitest'
import { convertLatexAstToTypstAst, convertLatexToTypst, parseLatexMath, renderTypstMathAst } from './latex-to-typst'

describe('laTeX to Typst math conversion', () => {
  it('normalizes the KaTeX AST without exposing parser locations', () => {
    const nodes = parseLatexMath(String.raw`\frac{a}{b}`)
    expect(nodes[0]).toMatchObject({ type: 'genfrac' })
    expect(JSON.stringify(nodes)).not.toContain('lexer')
  })

  it('converts a normalized LaTeX AST directly', () => {
    const ast = convertLatexAstToTypstAst([
      { type: 'mathord', mode: 'math', text: 'x' },
      { type: 'atom', mode: 'math', family: 'rel', text: '=' },
      { type: 'textord', mode: 'math', text: '1' },
    ])
    expect(renderTypstMathAst(ast)).toBe('x = 1')
  })

  it('converts fractions and roots into Typst calls', () => {
    const result = convertLatexToTypst(String.raw`\frac{a_1}{\sqrt{x}}`)
    expect(result.source).toBe('frac(a_(1), sqrt(x))')
    expect(result.fallback).toBe(false)
  })

  it('converts symbols, relations, and operators', () => {
    expect(convertLatexToTypst(String.raw`x^2 + \alpha \le \beta`).source)
      .toBe('x^(2) + alpha lt.eq beta')
    expect(convertLatexToTypst(String.raw`\sum_{i=1}^n i`).source)
      .toBe('sum^(n)_(i = 1) i')
  })

  it('converts text and matrices', () => {
    expect(convertLatexToTypst(String.raw`\text{hello}`).source).toBe('#text("hello")')
    expect(convertLatexToTypst(String.raw`\begin{matrix}a&b\\c&d\end{matrix}`).source)
      .toBe('mat(a, b; c, d)')
    expect(convertLatexToTypst(String.raw`\binom{n}{k}`).source).toBe('binom(n, k)')
  })

  it('converts accents using their AST base node', () => {
    expect(convertLatexToTypst(String.raw`\vec{x}`).source).toBe('arrow(x)')
  })

  it('converts higher roots', () => {
    expect(convertLatexToTypst(String.raw`\sqrt[3]{x}`).source).toBe('root(3, x)')
  })

  it('converts common math fonts', () => {
    expect(convertLatexToTypst(String.raw`\mathbf{x}+\mathbb{R}+\mathcal{F}+\mathfrak{g}+\mathrm{d}`).source)
      .toBe('bold(x) + bb(R) + cal(F) + frak(g) + upright(d)')
  })

  it('converts limits and integrals, including thin-space nodes', () => {
    expect(convertLatexToTypst(String.raw`\lim_{x\to 0} \frac{\sin x}{x}`).source)
      .toBe('lim_(x arrow.r 0) frac(sin x, x)')
    const integral = convertLatexToTypst(String.raw`\int_0^1 x^2\,dx`)
    expect(integral.source).toBe('integral^(1)_(0) x^(2) d x')
    expect(integral.fallback).toBe(false)
  })

  it('converts colors', () => {
    expect(convertLatexToTypst(String.raw`\color{red}{x+1}`).source)
      .toBe('#text(fill: red)[x + 1]')
  })

  it('converts bracket and delimiter variants', () => {
    expect(convertLatexToTypst(String.raw`\left[\frac{a}{b}\right]`).source)
      .toBe('[frac(a, b)]')
    expect(convertLatexToTypst(String.raw`\left\{x\right\}`).source)
      .toBe('\\{x\\}')
    expect(convertLatexToTypst(String.raw`\left\langle x \right\rangle`).source)
      .toBe('⟨x⟩')
    expect(convertLatexToTypst(String.raw`\left\lfloor x \right\rfloor`).source)
      .toBe('⌊x⌋')
  })

  it('converts the remaining common accents', () => {
    expect(convertLatexToTypst(String.raw`\hat{x}+\bar{y}+\dot{z}`).source)
      .toBe('hat(x) + overline(y) + dot(z)')
  })

  it('preserves complex nested expressions', () => {
    expect(convertLatexToTypst(String.raw`\frac{1+\sqrt{\frac{x^2+1}{y}}}{\sqrt[3]{z_1}}`).source)
      .toBe('frac(1 + sqrt(frac(x^(2) + 1, y)), root(3, z_(1)))')
  })

  it('keeps plain text math outside math syntax', () => {
    const result = convertLatexToTypst('fasdfasfd')
    expect(result.source).toBe('#text("fasdfasfd")')
    expect(result.fallback).toBe(true)
    expect(result.diagnostics[0]?.severity).toBe('warning')
  })

  it('returns a diagnostic and safe fallback for invalid LaTeX', () => {
    const result = convertLatexToTypst(String.raw`\unknowncommand{a}`)
    expect(result.fallback).toBe(true)
    expect(result.source).toContain('#text(')
    expect(result.diagnostics[0]?.severity).toBe('error')
  })

  it('renders an explicitly constructed Typst AST', () => {
    expect(renderTypstMathAst({
      type: 'call',
      value: 'frac',
      children: [
        { type: 'symbol', value: 'a' },
        { type: 'symbol', value: 'b' },
      ],
    })).toBe('frac(a, b)')
  })
})
