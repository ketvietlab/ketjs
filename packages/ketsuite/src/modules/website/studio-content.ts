import { KetError } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'

const failure = (message: string) => (): never => {
  throw new KetError({ code: 'E_WEBSITE_DOCUMENT', message })
}
const invalid = failure('Nội dung bài viết không hợp lệ.')
const record = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
// LiveDoc stores a divider like any other block, with an empty delta. It was missing here,
// so a post with a horizontal rule saved in the Atlas and was refused by the real host.
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
const safeUrl = (value: unknown) =>
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

/** The description a term's editor sends, checked the way a post body is. */
export const termDescription = (raw: unknown) =>
  liveDocument(raw, { images: false, fail: failure('Nội dung mô tả không hợp lệ.') })

export const isSafeUrl = safeUrl

/** Validate native editor data on every write path and derive search text server-side. */
export function studioFields(type: string, input: unknown): Row {
  const fields = { ...record(input) }
  if (fields.seo != null) {
    const seo = record(fields.seo)
    if (
      Object.keys(seo).some((k) => !['title', 'description', 'canonical', 'indexing', 'image'].includes(k)) ||
      Object.values(seo).some((v) => typeof v !== 'string') ||
      (seo.canonical && !safeUrl(seo.canonical)) ||
      (seo.indexing && !['index', 'noindex'].includes(String(seo.indexing)))
    )
      invalid()
  }
  if (type !== 'website.post' || fields.bodyDoc == null || fields.bodyDoc === '') return fields
  const body = liveDocument(fields.bodyDoc, { images: true })
  fields.bodyDoc = body.doc
  fields.bodyText = body.text
  return fields
}

/** Product-owned starter content, independent from Atlas fixtures and customer records. */
export const pageTemplates = [
  {
    id: 'website-introduction',
    title: 'Giới thiệu',
    heading: 'Câu chuyện của chúng tôi',
    body: 'Giới thiệu đội ngũ, giá trị và hành trình của bạn.',
    ctaLabel: 'Liên hệ',
    ctaHref: '/lien-he',
  },
  {
    id: 'website-service',
    title: 'Dịch vụ',
    heading: 'Dịch vụ dành cho bạn',
    body: 'Trình bày dịch vụ, lợi ích và cách liên hệ.',
    ctaLabel: 'Tìm hiểu thêm',
    ctaHref: '/lien-he',
  },
  {
    id: 'website-cosmetics',
    title: 'Mỹ phẩm',
    heading: 'Chăm sóc làn da mỗi ngày',
    body: 'Giới thiệu sản phẩm và hướng dẫn chăm sóc phù hợp.',
    ctaLabel: 'Khám phá',
    ctaHref: '/san-pham',
  },
]
