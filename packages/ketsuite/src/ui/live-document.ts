import type { Row } from '@ketvietlab/ketjs'
const record = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
const invalid = (): never => {
  throw new Error('Nội dung không hợp lệ.')
}
const types = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'quote',
  'code',
  'bullet',
  'ordered',
  'check',
  'table',
  'divider',
  'image',
])
export const safeUrl = (value: unknown) =>
  typeof value === 'string' && (!value || /^(?:https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(value))

/**
 * Check a LiveDoc document and derive its plain text. A term's description takes no images:
 * an image in it would have no owner to be claimed by, and no place in a listing.
 */
export function liveDocument(
  raw: unknown,
  { images, fail = invalid }: { images: boolean; fail?: () => never },
): { doc: string; text: string } {
  let blocks: unknown
  try {
    blocks = JSON.parse(String(raw))
  } catch {
    return fail()
  }
  if (!Array.isArray(blocks) || blocks.length > 500) return fail()
  const texts: string[] = []
  for (const item of blocks) {
    const block = record(item)
    if (
      !types.has(String(block.type)) ||
      (!images && block.type === 'image') ||
      !Array.isArray(block.delta) ||
      block.delta.length > 10000
    )
      fail()
    if (block.type === 'image') {
      if (
        typeof block.src !== 'string' ||
        !/^\/website\/files\/[A-Za-z0-9-]+$/.test(block.src) ||
        typeof block.alt !== 'string'
      )
        fail()
      if (
        block.width != null &&
        (!Number.isFinite(block.width) || Number(block.width) < 10 || Number(block.width) > 100)
      )
        fail()
      if (block.align != null && !['left', 'center', 'right'].includes(String(block.align))) fail()
    }
    const parts: string[] = []
    for (const op of block.delta as unknown[]) {
      const part = record(op)
      if (
        typeof part.insert !== 'string' ||
        (record(part.attributes).link && !safeUrl(record(part.attributes).link))
      )
        fail()
      parts.push(part.insert as string)
    }
    if (block.type === 'table') {
      if (
        !Array.isArray(block.rows) ||
        block.rows.length > 100 ||
        block.rows.some((r) => !Array.isArray(r) || r.length > 20 || r.some((c) => typeof c !== 'string'))
      )
        fail()
      texts.push((block.rows as string[][]).map((r) => r.join(' | ')).join('\n'))
    } else texts.push(parts.join(''))
  }
  return { doc: JSON.stringify(blocks), text: texts.join('\n\n') }
}
