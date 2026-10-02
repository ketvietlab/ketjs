import { newId } from './format.ts'
import type { Placement } from '../types.ts'
import type { PageTemplate } from './builder-types.ts'

// The same template expansion is used for new pages and replacement in the builder.
export const templateLayout = (template: Omit<PageTemplate, 'id' | 'title'>): Placement[] => [
  {
    id: newId('node'),
    type: 'website.hero',
    settings: {
      heading: template.heading ?? '',
      ctaLabel: template.ctaLabel ?? '',
      ctaHref: template.ctaHref ?? '',
    },
  },
  { id: newId('node'), type: 'website.rich_text', settings: { body: template.body ?? '' } },
]
