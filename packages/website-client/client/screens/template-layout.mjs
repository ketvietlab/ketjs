import { newId } from './format.mjs'

// The same template expansion is used for new pages and replacement in the builder.
export const templateLayout = (template) => [
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
