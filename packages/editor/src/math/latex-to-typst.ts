import * as katex from 'katex'

export interface LatexMathNode {
  type: string
  mode?: 'math' | 'text'
  text?: string
  body?: LatexMathNode | readonly LatexMathNode[] | readonly (readonly LatexMathNode[])[]
  numer?: LatexMathNode
  denom?: LatexMathNode
  base?: LatexMathNode
  sup?: LatexMathNode
  sub?: LatexMathNode
  name?: string
  label?: string
  font?: string
  family?: string
  symbol?: boolean
  limits?: boolean
  hasBarLine?: boolean
  left?: string | null
  right?: string | null
  leftDelim?: string | null
  rightDelim?: string | null
  index?: LatexMathNode | null
  style?: string
  color?: string
}

export interface TypstMathAst {
  type: string
  value?: string
  children?: readonly TypstMathAst[]
  attributes?: Readonly<Record<string, unknown>>
}

export interface LatexToTypstDiagnostic {
  message: string
  severity: 'warning' | 'error'
}

export interface LatexToTypstResult {
  ast: TypstMathAst
  source: string
  diagnostics: readonly LatexToTypstDiagnostic[]
  /** True when the input could not safely be emitted in a Typst math context. */
  fallback: boolean
}

interface KatexParserModule {
  __parse?: (source: string) => readonly unknown[]
}

const katexParser = (katex as unknown as KatexParserModule).__parse

/**
 * KaTeX's parser is intentionally used only at this boundary. It is the parser
 * already used by the editor, while the normalized nodes below keep Typst
 * export independent from KaTeX's private `loc` and lexer objects.
 */
export function parseLatexMath(source: string): LatexMathNode[] {
  if (katexParser === undefined)
    throw new Error('The installed KaTeX build does not expose its parser')
  return katexParser(source).map(value => normalizeLatexNode(value))
}

function normalizeLatexNode(value: unknown): LatexMathNode {
  if (typeof value !== 'object' || value === null)
    throw new Error('KaTeX returned an invalid math node')
  const input = value as Record<string, unknown>
  const node: LatexMathNode = { type: String(input.type ?? 'unknown') }
  if (input.mode === 'math' || input.mode === 'text')
    node.mode = input.mode
  if (typeof input.text === 'string')
    node.text = input.text
  if (typeof input.name === 'string')
    node.name = input.name
  if (typeof input.label === 'string')
    node.label = input.label
  if (typeof input.font === 'string')
    node.font = input.font
  if (typeof input.family === 'string')
    node.family = input.family
  if (typeof input.symbol === 'boolean')
    node.symbol = input.symbol
  if (typeof input.limits === 'boolean')
    node.limits = input.limits
  if (typeof input.hasBarLine === 'boolean')
    node.hasBarLine = input.hasBarLine
  if (typeof input.left === 'string' || input.left === null)
    node.left = input.left
  if (typeof input.right === 'string' || input.right === null)
    node.right = input.right
  if (typeof input.leftDelim === 'string' || input.leftDelim === null)
    node.left = input.leftDelim
  if (typeof input.rightDelim === 'string' || input.rightDelim === null)
    node.right = input.rightDelim
  if (input.index === null)
    node.index = null
  else if (input.index !== undefined)
    node.index = normalizeLatexNode(input.index)
  if (typeof input.style === 'string')
    node.style = input.style
  if (typeof input.color === 'string')
    node.color = input.color

  for (const key of ['body', 'numer', 'denom', 'base', 'sup', 'sub'] as const) {
    const child = input[key]
    if (Array.isArray(child)) {
      node[key] = child.map(item => Array.isArray(item)
        ? item.map(value => normalizeLatexNode(value))
        : normalizeLatexNode(item)) as never
    }
    else if (child !== undefined) {
      node[key] = normalizeLatexNode(child) as never
    }
  }
  return node
}

const symbolNames: Readonly<Record<string, string>> = {
  '\\alpha': 'alpha',
  '\\beta': 'beta',
  '\\chi': 'chi',
  '\\delta': 'delta',
  '\\epsilon': 'epsilon',
  '\\gamma': 'gamma',
  '\\in': 'in',
  '\\infty': 'infinity',
  '\\kappa': 'kappa',
  '\\lambda': 'lambda',
  '\\le': 'lt.eq',
  '\\leq': 'lt.eq',
  '\\mu': 'mu',
  '\\neq': '!=',
  '\\nu': 'nu',
  '\\omega': 'omega',
  '\\phi': 'phi',
  '\\pi': 'pi',
  '\\pm': '+-',
  '\\prod': 'product',
  '\\rho': 'rho',
  '\\sigma': 'sigma',
  '\\sqrt': 'sqrt',
  '\\sum': 'sum',
  '\\tau': 'tau',
  '\\theta': 'theta',
  '\\times': 'times',
  '\\to': 'arrow.r',
  '\\upsilon': 'upsilon',
  '\\xi': 'xi',
  '\\zeta': 'zeta',
  '\\cdot': 'dot',
  '\\div': 'div',
  '\\ge': 'gt.eq',
  '\\geq': 'gt.eq',
  '\\mp': '-+',
  '\\notin': 'in.not',
  '\\int': 'integral',
}

const operatorNames: Readonly<Record<string, string>> = {
  '\\arccos': 'arccos',
  '\\arcsin': 'arcsin',
  '\\arctan': 'arctan',
  '\\cos': 'cos',
  '\\det': 'det',
  '\\dim': 'dim',
  '\\exp': 'exp',
  '\\gcd': 'gcd',
  '\\hom': 'hom',
  '\\inf': 'inf',
  '\\ker': 'ker',
  '\\lim': 'lim',
  '\\ln': 'ln',
  '\\log': 'log',
  '\\max': 'max',
  '\\min': 'min',
  '\\Pr': 'Pr',
  '\\sup': 'sup',
  '\\tan': 'tan',
}

const delimiterNames: Readonly<Record<string, string>> = {
  '\\{': '\\{',
  '\\}': '\\}',
  '\\langle': '⟨',
  '\\rangle': '⟩',
  '\\lbrace': '\\{',
  '\\rbrace': '\\}',
  '\\lfloor': '⌊',
  '\\rfloor': '⌋',
  '\\lceil': '⌈',
  '\\rceil': '⌉',
  '\\lvert': '|',
  '\\rvert': '|',
  '\\Vert': '‖',
  '\\vert': '|',
}

function typstString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')
}

const leaf = (type: string, value: string, attributes?: Readonly<Record<string, unknown>>): TypstMathAst => ({ type, value, attributes })
const group = (children: readonly TypstMathAst[]): TypstMathAst => ({ type: 'group', children })

function childrenOf(node: LatexMathNode | undefined): LatexMathNode[] {
  if (node === undefined || node.body === undefined)
    return []
  const body = node.body
  if (!Array.isArray(body))
    return [body as LatexMathNode]
  if (body.length === 0)
    return []
  return Array.isArray(body[0])
    ? (body as readonly (readonly LatexMathNode[])[]).flat()
    : Array.from(body as readonly LatexMathNode[])
}

function directBody(node: LatexMathNode): LatexMathNode | undefined {
  return node.body !== undefined && !Array.isArray(node.body) ? node.body as LatexMathNode : undefined
}

function convertSequence(nodes: readonly LatexMathNode[]): TypstMathAst {
  return { type: 'sequence', children: nodes.map(convertNode) }
}

function convertBody(node: LatexMathNode): TypstMathAst {
  return { type: 'sequence', children: childrenOf(node).map(convertNode) }
}

function convertNode(node: LatexMathNode): TypstMathAst {
  switch (node.type) {
    case 'mathord':
    case 'textord': {
      const value = node.text ?? ''
      if (node.mode === 'text')
        return leaf('text', value, { mode: 'text' })
      return leaf('symbol', symbolNames[value] ?? value, { mode: 'math' })
    }
    case 'atom': {
      const value = node.text ?? ''
      return leaf('symbol', symbolNames[value] ?? value, { family: node.family ?? 'ord' })
    }
    case 'ordgroup':
    case 'styling':
      return group(childrenOf(node).map(convertNode))
    case 'supsub': {
      const children: TypstMathAst[] = node.base === undefined ? [] : [convertNode(node.base)]
      if (node.sup !== undefined)
        children.push({ type: 'sup', children: [convertNode(node.sup)] })
      if (node.sub !== undefined)
        children.push({ type: 'sub', children: [convertNode(node.sub)] })
      return { type: 'scripts', children }
    }
    case 'genfrac': {
      const numerator = convertNode(node.numer ?? { type: 'ordgroup', body: [] })
      const denominator = convertNode(node.denom ?? { type: 'ordgroup', body: [] })
      if (node.hasBarLine === false && node.left === '(' && node.right === ')')
        return { type: 'call', value: 'binom', children: [numerator, denominator] }
      return { type: 'call', value: 'frac', children: [numerator, denominator] }
    }
    case 'sqrt': {
      const body = convertNode(directBody(node) ?? { type: 'ordgroup', body: childrenOf(node) })
      return node.index === undefined || node.index === null
        ? { type: 'call', value: 'sqrt', children: [body] }
        : { type: 'call', value: 'root', children: [convertNode(node.index), body] }
    }
    case 'op': {
      const name = node.name ?? ''
      return leaf('operator', operatorNames[name] ?? symbolNames[name] ?? name.replace(/^\\/u, ''), { limits: node.limits })
    }
    case 'text': {
      const text = childrenOf(node).map(child => child.text ?? '').join('')
      return leaf('text', text, { mode: 'text' })
    }
    case 'kern':
      return leaf('space', '')
    case 'array': {
      const rows = Array.isArray(node.body) && Array.isArray(node.body[0])
        ? (node.body as readonly (readonly LatexMathNode[])[]).map(row => ({
            type: 'row',
            children: row.map(cell => group(childrenOf(cell).map(convertNode))),
          }))
        : []
      return { type: 'matrix', children: rows }
    }
    case 'leftright':
      return { type: 'delimited', value: `${node.left ?? '.'}|${node.right ?? '.'}`, children: [convertBody(node)] }
    case 'font': {
      const body = convertNode(directBody(node) ?? { type: 'ordgroup', body: childrenOf(node) })
      const font = node.font ?? ''
      const name = font === 'mathbb' ? 'bb' : font === 'mathcal' ? 'cal' : font === 'mathfrak' ? 'frak' : font === 'mathbf' ? 'bold' : font === 'mathrm' ? 'upright' : font
      return { type: 'call', value: name, children: [body] }
    }
    case 'overline':
      return { type: 'call', value: 'overline', children: [convertBody(node)] }
    case 'accent': {
      const accent = node.label === '\\vec' ? 'arrow' : node.label === '\\hat' ? 'hat' : node.label === '\\bar' ? 'overline' : 'dot'
      return {
        type: 'call',
        value: accent,
        children: [node.base === undefined ? leaf('symbol', node.text ?? '') : convertNode(node.base)],
      }
    }
    case 'color':
      return { type: 'color', value: node.color ?? 'black', children: [convertBody(node)] }
    default:
      return leaf('unsupported', node.text ?? '')
  }
}

function renderNode(node: TypstMathAst): string {
  switch (node.type) {
    case 'sequence': return renderSequence(node.children)
    case 'group': return renderSequence(node.children)
    case 'symbol': return node.value ?? ''
    case 'operator': return node.value ?? ''
    case 'text': return `#text("${typstString(node.value ?? '')}")`
    case 'space': return ''
    case 'sup': return `^(${renderChildren(node)})`
    case 'sub': return `_(${renderChildren(node)})`
    case 'scripts': {
      const children = node.children ?? []
      return children.length === 0 ? '' : `${renderNode(children[0]!)}${children.slice(1).map(renderNode).join('')}`
    }
    case 'call': return `${node.value ?? 'unknown'}(${(node.children ?? []).map(renderNode).join(', ')})`
    case 'matrix': return `mat(${(node.children ?? []).map(row => (row.children ?? []).map(renderNode).join(', ')).join('; ')})`
    case 'row': return (node.children ?? []).map(renderNode).join(', ')
    case 'delimited': {
      const [left, right] = (node.value ?? '.|.').split('|')
      const leftValue = left ?? '.'
      const rightValue = right ?? '.'
      return `${leftValue === '.' ? '' : delimiterNames[leftValue] ?? leftValue}${renderChildren(node)}${rightValue === '.' ? '' : delimiterNames[rightValue] ?? rightValue}`
    }
    case 'color': return `#text(fill: ${node.value ?? 'black'})[${renderChildren(node)}]`
    default: return `#text("${typstString(node.value ?? '')}")`
  }
}

function renderSequence(children: readonly TypstMathAst[] | undefined): string {
  return (children ?? []).map(renderNode).filter(value => value.length > 0).join(' ')
}

function renderChildren(node: TypstMathAst): string {
  return (node.children ?? []).map(renderNode).join('')
}

function hasUnsupportedNode(node: TypstMathAst): boolean {
  return node.type === 'unsupported' || (node.children ?? []).some(hasUnsupportedNode)
}

export function renderTypstMathAst(ast: TypstMathAst): string {
  return renderNode(ast)
}

export function convertLatexAstToTypstAst(nodes: readonly LatexMathNode[]): TypstMathAst {
  return convertSequence(nodes)
}

function isPlainTextMath(source: string): boolean {
  return /^[A-Za-z][\w -]*$/u.test(source.trim()) && source.trim().length > 1
}

export function convertLatexToTypst(source: string): LatexToTypstResult {
  if (isPlainTextMath(source)) {
    const ast = leaf('text', source)
    return {
      ast,
      source: renderTypstMathAst(ast),
      diagnostics: [{ message: 'Plain text was emitted outside Typst math syntax', severity: 'warning' }],
      fallback: true,
    }
  }

  try {
    const ast = convertLatexAstToTypstAst(parseLatexMath(source))
    const rendered = renderTypstMathAst(ast)
    const unsupported = hasUnsupportedNode(ast)
    return {
      ast,
      source: rendered,
      diagnostics: unsupported ? [{ message: 'Unsupported LaTeX nodes were rendered as text', severity: 'warning' }] : [],
      fallback: unsupported,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse LaTeX math'
    const ast = leaf('text', source)
    return {
      ast,
      source: renderTypstMathAst(ast),
      diagnostics: [{ message, severity: 'error' }],
      fallback: true,
    }
  }
}
