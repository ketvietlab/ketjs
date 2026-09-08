import { each, html } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { LinkButton } from '../primitives/actions.tsx'
import { Code } from '../primitives/status.tsx'
import { componentGroups } from './groups.ts'

export { PageSurfacePreview, surfaceKinds, surfaceStates } from './page-surfaces.tsx'
export {
  InventoryPage,
  inventoryDecisions,
  inventoryKinds,
  inventoryScopes,
} from './inventory.tsx'
export type { InventoryPageProps } from './inventory.tsx'
export { designSystemInventory } from './inventory.generated.ts'
export { componentGroups, groupGovernance } from './groups.ts'
export type {
  CatalogueMaturity,
  CatalogueState,
  GovernedComponentGroup,
} from './groups.ts'
export { componentRegistry } from './registry.ts'
export type { ComponentRegistration } from './registry.ts'
export type { ComponentExample, ComponentGroup } from './specimens.tsx'

export const CATALOGUE_HOOKS = [
  'catalogue-surface-preview',
  'catalogue',
  'catalogue-rail',
  'catalogue-brand',
  'catalogue-kicker',
  'catalogue-nav',
  'catalogue-nav-group',
  'catalogue-nav-count',
  'catalogue-main',
  'catalogue-hero',
  'catalogue-title',
  'catalogue-intro',
  'catalogue-controls',
  'catalogue-group',
  'catalogue-group-head',
  'catalogue-governance',
  'catalogue-specimen',
  'catalogue-specimen-head',
  'catalogue-specimen-name',
  'catalogue-specimen-description',
  'catalogue-stage',
] as const

export const CatalogueHead = (): TemplateResult =>
  html`<meta name="description" content="Két Việt public component catalogue"><link rel="stylesheet" href="/design-system/catalogue/styles.css">`

export const CataloguePage = (
  props: { theme?: 'light' | 'dark' | 'system'; density?: 'compact' | 'default' | 'comfortable' } = {},
): TemplateResult => {
  const theme = props.theme ?? 'system'
  const density = props.density ?? 'default'
  const count = componentGroups.reduce((total, group) => total + group.examples.length, 0)
  return (
    <main
      data-kv-design-system
      data-ui="catalogue"
      data-theme={theme === 'system' ? null : theme}
      data-density={density}
    >
      <aside data-ui="catalogue-rail">
        <a data-ui="catalogue-brand" href="#top">
          <span aria-hidden="true">K</span>
          <strong>Két Việt</strong>
        </a>
        <p data-ui="catalogue-kicker">Design system · 0.1.5</p>
        <nav data-ui="catalogue-nav" aria-label="Component groups">
          {each(
            componentGroups,
            (group) => group.id,
            (group) => (
              <a data-ui="catalogue-nav-group" href={`#${group.id}`}>
                <span>{group.name}</span>
                <span data-ui="catalogue-nav-count">{String(group.examples.length)}</span>
              </a>
            ),
          )}
        </nav>
      </aside>
      <div data-ui="catalogue-main" id="top">
        <header data-ui="catalogue-hero">
          <div>
            <p data-ui="catalogue-kicker">Public components · server rendered</p>
            <h1 data-ui="catalogue-title">Két Việt Design System</h1>
            <p data-ui="catalogue-intro">
              {String(count)} specimens from one markup, token and state contract. Dense enough for daily
              work; quiet enough for decisions.
            </p>
            <LinkButton
              label="Review page surfaces"
              href="/surfaces?kind=record&theme=light"
              variant="secondary"
            />
            <LinkButton label="Review inventory" href="/inventory" variant="secondary" />
          </div>
          <div data-ui="catalogue-controls" role="group" aria-label="Catalogue preferences">
            <span>Theme</span>
            <a href={`/?theme=light&density=${density}`} aria-current={theme === 'light' ? 'page' : null}>
              Light
            </a>
            <a href={`/?theme=dark&density=${density}`} aria-current={theme === 'dark' ? 'page' : null}>
              Dark
            </a>
            <a href={`/?theme=system&density=${density}`} aria-current={theme === 'system' ? 'page' : null}>
              System
            </a>
            <span>Density</span>
            <a href={`/?theme=${theme}&density=compact`} aria-current={density === 'compact' ? 'page' : null}>
              Compact
            </a>
            <a href={`/?theme=${theme}&density=default`} aria-current={density === 'default' ? 'page' : null}>
              Default
            </a>
            <a
              href={`/?theme=${theme}&density=comfortable`}
              aria-current={density === 'comfortable' ? 'page' : null}
            >
              Comfort
            </a>
          </div>
        </header>
        {each(
          componentGroups,
          (group) => group.id,
          (group) => (
            <section
              data-ui="catalogue-group"
              id={group.id}
              data-owner={group.owner}
              data-maturity={group.maturity}
            >
              <header data-ui="catalogue-group-head">
                <div>
                  <p data-ui="catalogue-kicker">
                    {String(group.examples.length).padStart(2, '0')} components
                  </p>
                  <h2>{group.name}</h2>
                </div>
                <div>
                  <p>{group.description}</p>
                  <p data-ui="catalogue-governance">
                    {group.owner} · {group.maturity} · {group.states.join(' / ')}
                  </p>
                </div>
              </header>
              {each(
                group.examples,
                (example) => example.id,
                (example) => (
                  <article data-ui="catalogue-specimen" id={example.id}>
                    <header data-ui="catalogue-specimen-head">
                      <div>
                        <h3 data-ui="catalogue-specimen-name">{example.name}</h3>
                        <p data-ui="catalogue-specimen-description">{example.description}</p>
                      </div>
                      <Code value="@ketvietlab/design-system" context="package" />
                    </header>
                    <div data-ui="catalogue-stage">{example.render()}</div>
                  </article>
                ),
              )}
            </section>
          ),
        )}
      </div>
    </main>
  )
}
