import type { SectionDef } from '@ketvietlab/ketjs'

/**
 * Sections this module provides. The settings schema is doing two jobs at once:
 * it is what a page layout is validated against, and it is what an agent is handed
 * when asked to compose a page.
 */
export const sections: Record<string, SectionDef> = {
  'website.hero': {
    title: 'Ảnh bìa lớn',
    settings: {
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
    settings: { gap: 'text?' },
    slots: { left: { max: 20 }, right: { max: 20 } },
  },
  'website.rich_text': {
    title: 'Đoạn văn bản',
    settings: { heading: 'text?', body: 'text', align: 'text?' },
  },
}
