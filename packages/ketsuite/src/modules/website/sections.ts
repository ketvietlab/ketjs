import type { SectionDef } from '@ketvietlab/ketjs'

/**
 * Sections this module provides. The settings schema is doing two jobs at once:
 * it is what a page layout is validated against, and it is what an agent is handed
 * when asked to compose a page.
 */
export const sections: Record<string, SectionDef> = {
  'website.hero': {
    title: 'Ảnh bìa lớn',
    settings: { heading: 'text', subheading: 'text?', image: 'text?', ctaLabel: 'text?', ctaHref: 'text?' },
  },
  'website.rich_text': {
    title: 'Đoạn văn bản',
    settings: { heading: 'text?', body: 'text', align: 'text?' },
  },
}
