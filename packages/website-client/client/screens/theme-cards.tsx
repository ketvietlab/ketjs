import { CardGrid, ContentCard, Status, LinkButton, EmptyState } from '@ketvietlab/design-system'
import type { ResourceRecord } from '../resources.ts'
import type { StudioContext } from '../types.ts'

// Covers use the same bundled illustrations as the corresponding public theme presets.
export function themeCards(ctx: StudioContext, rows: readonly ResourceRecord[]) {
  const tr = ctx.tr
  if (!rows.length) {
    // Only someone who can manage the site is invited to create a theme.
    const canCreate = ctx.can('website.site.manage')
    return (
      <EmptyState
        title={tr('website.resource.empty')}
        message={tr(canCreate ? 'website.resource.emptyHelp' : 'website.theme.emptyReader')}
      />
    )
  }
  return (
    <CardGrid
      minimum="wide"
      items={rows}
      id={(row) => row.id}
      card={(row) => (
        <ContentCard
          title={row.title ?? ''}
          href={ctx.href('themes-edit', { id: row.id })}
          media={
            <img
              class="website-theme-cover"
              src={
                row.preset === 'cosmetics'
                  ? '/website-client/theme/cosmetics/collection.svg'
                  : '/website-client/theme/garden.svg'
              }
              alt={tr('website.theme.cover', { title: row.title ?? '' })}
              width="640"
              height="360"
              loading="lazy"
            />
          }
          status={
            <Status
              label={tr(
                row.state === 'published' ? 'website.entry.state.published' : 'website.entry.state.draft',
              )}
              tone={row.state === 'published' ? 'positive' : 'neutral'}
            />
          }
          summary={tr(row.preset === 'cosmetics' ? 'website.option.cosmetics' : 'website.option.default')}
          meta={
            row.version ? (
              <span>
                {tr('website.resource.version')} {row.version}
              </span>
            ) : null
          }
          actions={
            ctx.can('website.site.manage') ? (
              <LinkButton
                label={tr('website.resource.edit')}
                href={ctx.href('themes-edit', { id: row.id })}
              />
            ) : null
          }
        />
      )}
    />
  )
}
