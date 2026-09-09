import { each, html } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { LinkButton } from '../primitives/actions/index.tsx'
import { Code } from '../primitives/status/index.tsx'
import { componentGroups } from './groups.ts'
import { designSystemInventory } from './inventory.generated.ts'
import { componentRegistry } from './registry.ts'

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
  'catalogue-nav-section',
  'catalogue-nav-group',
  'catalogue-nav-count',
  'catalogue-main',
  'catalogue-hero',
  'catalogue-title',
  'catalogue-intro',
  'catalogue-controls',
  'catalogue-metrics',
  'catalogue-doc-grid',
  'catalogue-doc-card',
  'catalogue-component-index',
  'catalogue-component-list',
  'catalogue-component-link',
  'catalogue-group',
  'catalogue-group-head',
  'catalogue-governance',
  'catalogue-specimen',
  'catalogue-specimen-head',
  'catalogue-specimen-name',
  'catalogue-specimen-description',
  'catalogue-specimen-components',
  'catalogue-stage',
] as const

export const CatalogueHead = (): TemplateResult =>
  html`<meta name="description" content="Két Việt public component documentation"><link rel="stylesheet" href="/design-system/catalogue/styles.css"><script type="module" src="/design-system/runtime/auto.js"></script>`

type CataloguePageProps = {
  theme?: 'light' | 'dark' | 'system'
  density?: 'compact' | 'default' | 'comfortable'
  mode?: 'overview' | 'components' | 'all'
  groupId?: string | null
  path?: string
}

const registrationsFor = (groupId: string) =>
  componentRegistry.filter((registration) => registration.groupId === groupId)

const pathWithPreferences = (
  path: string,
  theme: NonNullable<CataloguePageProps['theme']>,
  density: NonNullable<CataloguePageProps['density']>,
): string => `${path}?theme=${theme}&density=${density}`

const CatalogueRail = (props: {
  active: string
  theme: NonNullable<CataloguePageProps['theme']>
  density: NonNullable<CataloguePageProps['density']>
}): TemplateResult => (
  <aside data-ui="catalogue-rail">
    <a data-ui="catalogue-brand" href={pathWithPreferences('/', props.theme, props.density)}>
      <span aria-hidden="true">K</span>
      <strong>Két Việt</strong>
    </a>
    <p data-ui="catalogue-kicker">Design system · {designSystemInventory.version}</p>
    <nav data-ui="catalogue-nav" aria-label="Design system documentation">
      <span data-ui="catalogue-nav-section">Get started</span>
      <a
        data-ui="catalogue-nav-group"
        href={pathWithPreferences('/', props.theme, props.density)}
        aria-current={props.active === 'overview' ? 'page' : null}
      >
        <span>Overview</span>
      </a>
      <a
        data-ui="catalogue-nav-group"
        href={pathWithPreferences('/components', props.theme, props.density)}
        aria-current={props.active === 'components' ? 'page' : null}
      >
        <span>Components</span>
        <span data-ui="catalogue-nav-count">{String(componentRegistry.length)}</span>
      </a>
      <span data-ui="catalogue-nav-section">Component groups</span>
      {each(
        componentGroups,
        (group) => group.id,
        (group) => (
          <a
            data-ui="catalogue-nav-group"
            href={pathWithPreferences(`/components/${group.id}`, props.theme, props.density)}
            aria-current={props.active === group.id ? 'page' : null}
          >
            <span>{group.name}</span>
            <span data-ui="catalogue-nav-count">{String(registrationsFor(group.id).length)}</span>
          </a>
        ),
      )}
      <span data-ui="catalogue-nav-section">Reference</span>
      <a data-ui="catalogue-nav-group" href="/surfaces?kind=record&theme=light">
        <span>Page patterns</span>
        <span data-ui="catalogue-nav-count">3</span>
      </a>
      <a data-ui="catalogue-nav-group" href="/inventory">
        <span>Inventory</span>
      </a>
    </nav>
  </aside>
)

const CataloguePreferences = (props: {
  path: string
  theme: NonNullable<CataloguePageProps['theme']>
  density: NonNullable<CataloguePageProps['density']>
}): TemplateResult => (
  <div data-ui="catalogue-controls" role="group" aria-label="Catalogue preferences">
    <span>Theme</span>
    {each(
      ['light', 'dark', 'system'] as const,
      (value) => value,
      (value) => (
        <a
          href={pathWithPreferences(props.path, value, props.density)}
          aria-current={props.theme === value ? 'page' : null}
        >
          {value[0].toUpperCase() + value.slice(1)}
        </a>
      ),
    )}
    <span>Density</span>
    {each(
      ['compact', 'default', 'comfortable'] as const,
      (value) => value,
      (value) => (
        <a
          href={pathWithPreferences(props.path, props.theme, value)}
          aria-current={props.density === value ? 'page' : null}
        >
          {value === 'comfortable' ? 'Comfort' : value[0].toUpperCase() + value.slice(1)}
        </a>
      ),
    )}
  </div>
)

const Overview = (props: {
  theme: NonNullable<CataloguePageProps['theme']>
  density: NonNullable<CataloguePageProps['density']>
}): TemplateResult => (
  <>
    <header data-ui="catalogue-hero">
      <div>
        <p data-ui="catalogue-kicker">SSR-first · operational · accessible</p>
        <h1 data-ui="catalogue-title">The interface language for Két applications.</h1>
        <p data-ui="catalogue-intro">
          Reusable contracts for dense business software—designed to remain useful before JavaScript arrives
          and predictable when the workflow gets complicated.
        </p>
        <LinkButton
          label={`Explore ${String(componentRegistry.length)} components`}
          href={pathWithPreferences('/components', props.theme, props.density)}
          variant="primary"
        />
        <LinkButton label="Review inventory" href="/inventory" variant="secondary" />
      </div>
      <CataloguePreferences path="/" theme={props.theme} density={props.density} />
    </header>
    <section data-ui="catalogue-metrics" aria-label="Design system summary">
      <article>
        <strong>{String(componentRegistry.length)}</strong>
        <span>public components</span>
      </article>
      <article>
        <strong>{String(componentGroups.reduce((total, group) => total + group.examples.length, 0))}</strong>
        <span>executable specimens</span>
      </article>
      <article>
        <strong>{String(componentGroups.length)}</strong>
        <span>documented groups</span>
      </article>
      <article>
        <strong>{String(designSystemInventory.summary.plannedComponents)}</strong>
        <span>planned contracts</span>
      </article>
    </section>
    <section data-ui="catalogue-group">
      <header data-ui="catalogue-group-head">
        <div>
          <p data-ui="catalogue-kicker">System map</p>
          <h2>Start with the contract</h2>
        </div>
        <p>
          Use the smallest stable layer that owns the behavior. Recipes compose components; applications own
          business state.
        </p>
      </header>
      <div data-ui="catalogue-doc-grid">
        <article data-ui="catalogue-doc-card">
          <span>01</span>
          <h3>Foundations</h3>
          <p>Semantic tokens, density, focus, motion and responsive rules form one cascade.</p>
          <a href="/inventory#css">Inspect CSS ownership →</a>
        </article>
        <article data-ui="catalogue-doc-card">
          <span>02</span>
          <h3>Components</h3>
          <p>
            {String(componentRegistry.length)} renderer contracts with explicit owners, states and specimens.
          </p>
          <a href={pathWithPreferences('/components', props.theme, props.density)}>Browse components →</a>
        </article>
        <article data-ui="catalogue-doc-card">
          <span>03</span>
          <h3>Page patterns</h3>
          <p>ListPage, RecordPage and WorkspacePage are the only full-page identities.</p>
          <a href="/surfaces?kind=record&theme=light">Review page surfaces →</a>
        </article>
      </div>
    </section>
    <section data-ui="catalogue-group">
      <header data-ui="catalogue-group-head">
        <div>
          <p data-ui="catalogue-kicker">Component library</p>
          <h2>Explore the system</h2>
        </div>
        <p>Every number below is a component contract, not a specimen card.</p>
      </header>
      <div data-ui="catalogue-doc-grid">
        {each(
          componentGroups,
          (group) => group.id,
          (group) => (
            <a
              data-ui="catalogue-doc-card"
              href={pathWithPreferences(`/components/${group.id}`, props.theme, props.density)}
            >
              <span>{String(registrationsFor(group.id).length).padStart(2, '0')}</span>
              <h3>{group.name}</h3>
              <p>{group.description}</p>
            </a>
          ),
        )}
      </div>
    </section>
  </>
)

const ComponentIndex = (props: {
  theme: NonNullable<CataloguePageProps['theme']>
  density: NonNullable<CataloguePageProps['density']>
  path: string
}): TemplateResult => (
  <>
    <header data-ui="catalogue-hero">
      <div>
        <p data-ui="catalogue-kicker">Reference / components</p>
        <h1 data-ui="catalogue-title">{String(componentRegistry.length)} public components</h1>
        <p data-ui="catalogue-intro">
          Search the complete public surface by ownership group. Components may share a specimen, but every
          contract remains visible here.
        </p>
      </div>
      <CataloguePreferences path={props.path} theme={props.theme} density={props.density} />
    </header>
    <div data-ui="catalogue-component-index">
      {each(
        componentGroups,
        (group) => group.id,
        (group) => (
          <section data-ui="catalogue-component-list" aria-labelledby={`${group.id}-title`}>
            <header>
              <h2 id={`${group.id}-title`}>{group.name}</h2>
              <span>{String(registrationsFor(group.id).length)}</span>
            </header>
            {each(
              registrationsFor(group.id),
              (registration) => registration.name,
              (registration) => (
                <a
                  data-ui="catalogue-component-link"
                  href={`${pathWithPreferences(`/components/${group.id}`, props.theme, props.density)}#${registration.specimenId}`}
                >
                  <strong>{registration.name}</strong>
                  <small>{registration.maturity}</small>
                </a>
              ),
            )}
          </section>
        ),
      )}
    </div>
  </>
)

const ComponentGroup = (props: {
  group: (typeof componentGroups)[number]
  theme: NonNullable<CataloguePageProps['theme']>
  density: NonNullable<CataloguePageProps['density']>
  path: string
}): TemplateResult => {
  const registrations = registrationsFor(props.group.id)
  return (
    <>
      <header data-ui="catalogue-hero">
        <div>
          <p data-ui="catalogue-kicker">Components / {props.group.owner}</p>
          <h1 data-ui="catalogue-title">{props.group.name}</h1>
          <p data-ui="catalogue-intro">{props.group.description}</p>
          <p data-ui="catalogue-governance">
            {String(registrations.length)} components · {String(props.group.examples.length)} specimens ·{' '}
            {props.group.maturity} · {props.group.states.join(' / ')}
          </p>
        </div>
        <CataloguePreferences path={props.path} theme={props.theme} density={props.density} />
      </header>
      <section data-ui="catalogue-component-list" aria-label={`${props.group.name} components`}>
        <header>
          <h2>Component contracts</h2>
          <span>{String(registrations.length)}</span>
        </header>
        {each(
          registrations,
          (registration) => registration.name,
          (registration) => (
            <a data-ui="catalogue-component-link" href={`#${registration.specimenId}`}>
              <strong>{registration.name}</strong>
              <small>{registration.maturity}</small>
            </a>
          ),
        )}
      </section>
      <section data-ui="catalogue-group" id={props.group.id}>
        <header data-ui="catalogue-group-head">
          <div>
            <p data-ui="catalogue-kicker">Executable reference</p>
            <h2>Specimens</h2>
          </div>
          <p>Each specimen demonstrates one or more component contracts using production markup and CSS.</p>
        </header>
        {each(
          props.group.examples,
          (example) => example.id,
          (example) => {
            const covered = registrations.filter((registration) => registration.specimenId === example.id)
            return (
              <article data-ui="catalogue-specimen" id={example.id}>
                <header data-ui="catalogue-specimen-head">
                  <div>
                    <h3 data-ui="catalogue-specimen-name">{example.name}</h3>
                    <p data-ui="catalogue-specimen-description">{example.description}</p>
                    <p data-ui="catalogue-specimen-components">
                      {covered.map((registration) => registration.name).join(' · ')}
                    </p>
                  </div>
                  <Code value="@ketvietlab/design-system" context="package" />
                </header>
                <div data-ui="catalogue-stage">{example.render()}</div>
              </article>
            )
          },
        )}
      </section>
    </>
  )
}

export const CataloguePage = (props: CataloguePageProps = {}): TemplateResult => {
  const theme = props.theme ?? 'system'
  const density = props.density ?? 'default'
  const mode = props.mode ?? 'overview'
  const selectedGroup = componentGroups.find((group) => group.id === props.groupId)
  const path =
    props.path ??
    (selectedGroup ? `/components/${selectedGroup.id}` : mode === 'components' ? '/components' : '/')
  const active = selectedGroup?.id ?? mode
  return (
    <main
      data-kv-design-system
      data-ui="catalogue"
      data-theme={theme === 'system' ? null : theme}
      data-density={density}
    >
      <CatalogueRail active={active} theme={theme} density={density} />
      <div data-ui="catalogue-main" id="top">
        {selectedGroup ? (
          <ComponentGroup group={selectedGroup} theme={theme} density={density} path={path} />
        ) : mode === 'components' ? (
          <ComponentIndex theme={theme} density={density} path={path} />
        ) : mode === 'all' ? (
          <>
            <Overview theme={theme} density={density} />
            {each(
              componentGroups,
              (group) => group.id,
              (group) => (
                <ComponentGroup
                  group={group}
                  theme={theme}
                  density={density}
                  path={`/components/${group.id}`}
                />
              ),
            )}
          </>
        ) : (
          <Overview theme={theme} density={density} />
        )}
      </div>
    </main>
  )
}
