import { html } from '@ketvietlab/ketjs-view'
import { CardGrid, ContentCard, Status, LinkButton, EmptyState } from '@ketvietlab/design-system'
import { h } from '../ui.mjs'

// Covers use the same bundled illustrations as the corresponding public theme presets.
export function themeCards(ctx, rows) {
  const tr = ctx.tr
  if (!rows.length)
    return h(EmptyState, { title: tr('website.resource.empty'), message: tr('website.resource.emptyHelp') })
  return h(CardGrid, {
    minimum: 'wide',
    items: rows,
    id: (row) => row.id,
    card: (row) =>
      h(ContentCard, {
        title: row.title,
        href: ctx.href('themes-edit', { id: row.id }),
        media: html`<img class="website-theme-cover" src=${row.preset === 'cosmetics' ? '/website-client/theme/cosmetics/collection.svg' : '/website-client/theme/garden.svg'} alt=${tr('website.theme.cover', { title: row.title })} width="640" height="360" loading="lazy" />`,
        status: h(Status, {
          label: tr(
            row.state === 'published' ? 'website.entry.state.published' : 'website.entry.state.draft',
          ),
          tone: row.state === 'published' ? 'positive' : 'neutral',
        }),
        summary: tr(row.preset === 'cosmetics' ? 'website.option.cosmetics' : 'website.option.default'),
        meta: row.version ? html`<span>${tr('website.resource.version')} ${row.version}</span>` : null,
        actions: ctx.can('website.site.manage')
          ? h(LinkButton, {
              label: tr('website.resource.edit'),
              href: ctx.href('themes-edit', { id: row.id }),
            })
          : null,
      }),
  })
}
