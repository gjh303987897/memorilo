import { Buffer } from 'node:buffer'
import { basename } from 'node:path'

const maxArchiveBytes = 2 * 1024 * 1024 * 1024

function pdfLiteral(value: string): string {
  return `(${value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')})`
}

function pdfUtf16Hex(value: string): string {
  const bytes = Buffer.from(`\uFEFF${value}`, 'utf16le')
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const high = bytes[index]!
    bytes[index] = bytes[index + 1]!
    bytes[index + 1] = high
  }
  return `<${bytes.toString('hex').toUpperCase()}>`
}

// The pinned Typst compiler emits classic xrefs. Following their offsets keeps
// compressed payload bytes from being mistaken for attachment dictionaries.
function readPdfCrossReference(source: Buffer): { offset: number, objects: ReadonlyMap<number, number>, rootId: number, size: number } {
  const text = source.toString('latin1')
  const ending = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(text)
  const offset = Number(ending?.[1] ?? Number.NaN)
  if (!text.startsWith('%PDF-') || !Number.isSafeInteger(offset) || offset < 0 || offset >= source.length || !text.startsWith('xref', offset))
    throw new Error('PDF has an unsupported cross-reference table')
  const trailerStart = text.indexOf('trailer', offset)
  if (trailerStart < 0 || trailerStart >= ending!.index)
    throw new Error('PDF cross-reference trailer is missing')
  const rows = text.slice(offset + 4, trailerStart).trim().split(/\r?\n/u)
  const objects = new Map<number, number>()
  let row = 0
  while (row < rows.length) {
    const section = /^(\d+)\s+(\d+)$/u.exec(rows[row++]!.trim())
    if (!section)
      throw new Error('PDF cross-reference section is invalid')
    const first = Number(section[1])
    const count = Number(section[2])
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count > rows.length - row)
      throw new Error('PDF cross-reference section is invalid')
    for (let index = 0; index < count; index++) {
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])\s*$/u.exec(rows[row++]!)
      if (!entry)
        throw new Error('PDF cross-reference entry is invalid')
      if (entry[3] === 'f')
        continue
      const id = first + index
      const objectOffset = Number(entry[1])
      if (!Number.isSafeInteger(id) || objects.has(id) || entry[2] !== '00000' || objectOffset >= offset || !text.startsWith(`${id} 0 obj`, objectOffset))
        throw new Error('PDF cross-reference object is invalid')
      objects.set(id, objectOffset)
    }
  }
  const trailer = text.slice(trailerStart + 7, ending!.index)
  const rootId = Number(/\/Root\s+(\d+)\s+0\s+R/u.exec(trailer)?.[1] ?? Number.NaN)
  const size = Number(/\/Size\s+(\d+)/u.exec(trailer)?.[1] ?? Number.NaN)
  if (!Number.isSafeInteger(rootId) || !Number.isSafeInteger(size) || size <= rootId || !objects.has(rootId))
    throw new Error('PDF cross-reference catalog is invalid')
  return { objects, offset, rootId, size }
}

export function embedMemoAttachment(pdf: Uint8Array, memo: Uint8Array, fileName: string): Uint8Array {
  const source = Buffer.from(pdf)
  const text = source.toString('latin1')
  const { objects, offset: oldStartxref, rootId, size } = readPdfCrossReference(source)
  const rootStart = objects.get(rootId)!
  const rootEnd = text.indexOf('endobj', rootStart)
  if (rootStart < 0 || rootEnd < 0)
    throw new Error('Typst PDF catalog object is missing')
  const rootObject = text.slice(rootStart, rootEnd + 'endobj'.length)
  if (/\/Names\s/iu.test(rootObject))
    throw new Error('Typst PDF already contains an attachment name tree')
  const embeddedId = size
  const fileSpecId = size + 1
  const namesId = size + 2
  const updatedRoot = `${rootObject.slice(0, rootObject.lastIndexOf('>>'))}\n  /Names << /EmbeddedFiles ${namesId} 0 R >>\n  /AF [${fileSpecId} 0 R]\n${rootObject.slice(rootObject.lastIndexOf('>>'))}`
  const fallbackName = basename(fileName).replaceAll(/[^\x20-\x7E]|[()\\]/gu, '_') || 'note.memo'
  const embedded = Buffer.concat([
    Buffer.from(`${embeddedId} 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fvnd.memorilo.memo /Params << /Size ${memo.byteLength} >> /Length ${memo.byteLength} >>\nstream\n`, 'latin1'),
    Buffer.from(memo),
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
  const fileSpec = Buffer.from(`${fileSpecId} 0 obj\n<< /Type /Filespec /F ${pdfLiteral(fallbackName)} /UF ${pdfUtf16Hex(fileName)} /EF << /F ${embeddedId} 0 R >> /AFRelationship /Data >>\nendobj\n`, 'latin1')
  const names = Buffer.from(`${namesId} 0 obj\n<< /Names [${pdfLiteral(fallbackName)} ${fileSpecId} 0 R] >>\nendobj\n`, 'latin1')
  const root = Buffer.from(`${updatedRoot}\n`, 'latin1')
  const base = source[source.length - 1] === 0x0A ? source : Buffer.concat([source, Buffer.from('\n', 'latin1')])
  let output = Buffer.from(base)
  const offsets = new Map<number, number>()
  const append = (id: number, bytes: Uint8Array) => {
    offsets.set(id, output.length)
    output = Buffer.concat([output, Buffer.from(bytes)])
  }
  append(embeddedId, embedded)
  append(fileSpecId, fileSpec)
  append(namesId, names)
  append(rootId, root)
  const xrefOffset = output.length
  const xref = [
    'xref',
    `${rootId} 1`,
    `${String(offsets.get(rootId)).padStart(10, '0')} 00000 n `,
    `${embeddedId} 3`,
    `${String(offsets.get(embeddedId)).padStart(10, '0')} 00000 n `,
    `${String(offsets.get(fileSpecId)).padStart(10, '0')} 00000 n `,
    `${String(offsets.get(namesId)).padStart(10, '0')} 00000 n `,
    'trailer',
    `<< /Size ${size + 3} /Root ${rootId} 0 R /Prev ${oldStartxref} >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n')
  return Buffer.concat([output, Buffer.from(xref, 'latin1')])
}

export function extractMemoAttachment(pdf: Uint8Array): Uint8Array {
  const source = Buffer.from(pdf)
  const text = source.toString('latin1')
  const { objects, offset, rootId } = readPdfCrossReference(source)
  const readObject = (id: number): string => {
    const start = objects.get(id)
    if (start === undefined)
      throw new Error('PDF Memo attachment object is missing')
    const end = text.indexOf('endobj', start)
    if (end < 0 || end >= offset)
      throw new Error('PDF Memo attachment object is truncated')
    return text.slice(start, end)
  }
  const namesMatch = readObject(rootId).match(/\/EmbeddedFiles\s+(\d+)\s+0\s+R/u)
  if (!namesMatch)
    throw new Error('PDF does not contain an embedded Memo attachment')
  const namesId = Number.parseInt(namesMatch[1]!, 10)
  const namesObject = readObject(namesId)
  const namesStart = namesObject.indexOf('/Names [')
  const namesEnd = namesObject.indexOf(']', namesStart)
  const namesContent = namesStart < 0 || namesEnd < 0 ? '' : namesObject.slice(namesStart + '/Names ['.length, namesEnd)
  const fileSpecId = Number.parseInt(namesContent.match(/(\d+)\s0\sR/u)?.[1] ?? '', 10)
  if (!Number.isSafeInteger(fileSpecId))
    throw new Error('PDF Memo attachment name tree is invalid')
  const fileSpecObject = readObject(fileSpecId)
  const embeddedId = Number.parseInt(fileSpecObject.match(/\/EF\s*<<\s*\/F\s+(\d+)\s+0\s+R\s*>>/u)?.[1] ?? '', 10)
  if (!Number.isSafeInteger(embeddedId))
    throw new Error('PDF Memo attachment file specification is invalid')
  const embeddedStart = objects.get(embeddedId)
  if (embeddedStart === undefined)
    throw new Error('PDF Memo attachment stream is missing')
  const streamMarker = text.indexOf('\nstream', embeddedStart)
  if (streamMarker < 0 || streamMarker >= offset)
    throw new Error('PDF Memo attachment stream is missing')
  const embeddedObject = text.slice(embeddedStart, streamMarker)
  const length = Number.parseInt(embeddedObject.match(/\/Length\s+(\d+)/)?.[1] ?? '', 10)
  if (!Number.isSafeInteger(length) || length < 0 || length > maxArchiveBytes || !/\/Type\s+\/EmbeddedFile\b/u.test(embeddedObject) || /\/Filter\b/u.test(embeddedObject))
    throw new Error('PDF Memo attachment stream is invalid')
  let streamStart = streamMarker + '\nstream'.length
  if (source[streamStart] === 0x0D && source[streamStart + 1] === 0x0A)
    streamStart += 2
  else if (source[streamStart] === 0x0A || source[streamStart] === 0x0D)
    streamStart += 1
  else
    throw new Error('PDF Memo attachment stream separator is invalid')
  const streamEnd = streamStart + length
  if (streamEnd > offset || !/^\r?\nendstream\s+endobj\b/u.test(text.slice(streamEnd, streamEnd + 40)))
    throw new Error('PDF Memo attachment stream is truncated')
  return new Uint8Array(source.subarray(streamStart, streamEnd))
}
