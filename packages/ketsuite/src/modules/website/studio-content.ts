import { KetError } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'

const failure = (message: string) => (): never => {
  throw new KetError({ code: 'E_WEBSITE_DOCUMENT', message })
}
const invalid = failure('Nội dung bài viết không hợp lệ.')
const record = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
// LiveDoc stores a divider like any other block, with an empty delta. It was missing here,
// so a post with a horizontal rule saved in the Atlas and was refused by the real host.
import { liveDocument as validateDocument, safeUrl } from '../../ui/live-document.ts'
export const liveDocument = (raw: unknown, options: { images: boolean; fail?: () => never }) =>
  validateDocument(raw, { ...options, fail: options.fail ?? invalid })
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
