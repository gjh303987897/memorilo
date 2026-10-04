import { describe, expect, it } from 'vitest'
import { embedMemoAttachment, extractMemoAttachment } from './note-transfer-pdf'

function createPdfFixture(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(source.length)
    source += object
  }
  const xrefOffset = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(source)
}

describe('memo PDF attachment boundary', () => {
  it('embeds and extracts the exact Memo bytes from a real PDF', () => {
    const memo = Uint8Array.from([0, 1, 2, 10, 13, 37, 255])
    const pdf = embedMemoAttachment(createPdfFixture(), memo, '学习笔记.memo')

    expect(new TextDecoder('latin1').decode(pdf.subarray(0, 8))).toBe('%PDF-1.4')
    expect(extractMemoAttachment(pdf)).toEqual(memo)
  })

  it('rejects a normal PDF without a Memo attachment', () => {
    expect(() => extractMemoAttachment(new TextEncoder().encode('%PDF-1.7\n%%EOF\n'))).toThrow(/attachment|cross-reference/u)
  })
})
