import type { SectionDef } from '@ketvietlab/ketjs'

/**
 * Sections this module provides. The settings schema is doing two jobs at once:
 * it is what a page layout is validated against, and it is what an agent is handed
 * when asked to compose a page.
 */
const presentation = {
  responsive: 'json?',
  visibility: 'text?',
  profile: 'text?',
  locale: 'text?',
  layoutMode: 'text?',
}
const image = { alt: 'text?', focalX: 'int?', focalY: 'int?', imageFit: 'text?', imageRatio: 'text?' }
export const sections: Record<string, SectionDef> = {
  'website.hero': {
    title: 'Ảnh bìa lớn',
    settings: {
      ...presentation,
      ...image,
      heading: 'text',
      subheading: 'text?',
      /**
       * Declared as a reference so the library can tell where it is used. It
       * is still a string on the wire - the settings validator maps `ref` to
       * string - so every layout already stored keeps its meaning.
       */
      image: 'ref:website.MediaMetadata?',
      ctaLabel: 'text?',
      ctaHref: 'text?',
    },
  },
  /**
   * The first section that holds other sections.
   *
   * Two named slots rather than one child list, because a two-column section
   * has two places to put things and a page has to say which. Both are capped:
   * a slot with no ceiling is a way to put a page's whole content inside one
   * container and defeat the limit on the page.
   */
  'website.columns': {
    title: 'Hai cột',
    settings: { ...presentation, gap: 'text?' },
    slots: { left: { max: 20 }, right: { max: 20 } },
  },
  'website.rich_text': {
    title: 'Đoạn văn bản',
    settings: { ...presentation, heading: 'text?', body: 'text', align: 'text?' },
  },
  'website.gallery': {
    title: 'Bộ sưu tập ảnh',
    settings: {
      ...presentation,
      ...image,
      heading: 'text?',
      image: 'text?',
      image2: 'text?',
      caption: 'text?',
    },
  },
  'website.image': {
    title: 'Ảnh và chú thích',
    settings: { ...presentation, ...image, image: 'text', alt: 'text', caption: 'text?' },
  },
  'website.callout': {
    title: 'Kêu gọi hành động',
    settings: { ...presentation, heading: 'text', body: 'text?', ctaLabel: 'text', ctaHref: 'text' },
  },
  'website.quote': { title: 'Trích dẫn', settings: { ...presentation, body: 'text', author: 'text?' } },
  'website.faq': {
    title: 'Câu hỏi thường gặp',
    settings: { ...presentation, heading: 'text', body: 'text' },
  },
  'website.video': {
    title: 'Video',
    settings: { ...presentation, heading: 'text?', videoUrl: 'text', caption: 'text?' },
  },
}
