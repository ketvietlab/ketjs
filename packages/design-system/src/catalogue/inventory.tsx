import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { designSystemInventory } from './inventory.generated.ts'

type InventoryScope = 'all' | 'public' | 'compatibility' | 'planned'
type InventoryKind = 'all' | 'runtime' | 'type'
type InventoryDecision = 'all' | 'keep' | 'refactor' | 'promote' | 'build' | 'recipe' | 'domain' | 'defer'

export type InventoryPageProps = {
  scope?: InventoryScope
  kind?: InventoryKind
  decision?: InventoryDecision
  query?: string
}

export const inventoryScopes = ['all', 'public', 'compatibility', 'planned'] as const
export const inventoryKinds = ['all', 'runtime', 'type'] as const
export const inventoryDecisions = [
  'all',
  'keep',
  'refactor',
  'promote',
  'build',
  'recipe',
  'domain',
  'defer',
] as const

const label = (value: string): string =>
  ({
    all: 'All',
    public: 'Public package',
    compatibility: 'Compatibility kit',
    planned: 'Planned catalog',
    runtime: 'Runtime',
    type: 'Type',
    keep: 'Keep',
    refactor: 'Refactor',
    promote: 'Promote',
    build: 'Build',
    recipe: 'Recipe',
    domain: 'Domain',
    defer: 'Defer',
  })[value] ?? value

const statusLabel = (status: string): string =>
  status === 'present' ? 'Covered' : status === 'gap' ? 'Gap' : 'N/A'

const countBy = (decision: InventoryDecision): number =>
  designSystemInventory.rows.filter((row) => decision === 'all' || row.decision === decision).length

export const InventoryPage = (props: InventoryPageProps = {}): TemplateResult => {
  const scope = props.scope ?? 'all'
  const kind = props.kind ?? 'all'
  const decision = props.decision ?? 'all'
  const query = props.query?.trim().toLocaleLowerCase('en') ?? ''
  const rows = designSystemInventory.rows.filter(
    (row) =>
      (scope === 'all' || row.scope === scope) &&
      (kind === 'all' || row.kind === kind) &&
      (decision === 'all' || row.decision === decision) &&
      (!query ||
        [row.name, row.owner, row.source, row.target, row.gapTask]
          .join(' ')
          .toLocaleLowerCase('en')
          .includes(query)),
  )

  return (
    <main data-kv-design-system data-ui="inventory-page" data-theme="light">
      <aside data-ui="inventory-rail">
        <a data-ui="catalogue-brand" href="/">
          <span aria-hidden="true">K</span>
          <strong>Két Việt</strong>
        </a>
        <p data-ui="catalogue-kicker">Design system · {designSystemInventory.version}</p>
        <nav data-ui="inventory-nav" aria-label="Design system documentation">
          <a href="/">Components</a>
          <a href="/surfaces?kind=record&theme=light">Page patterns</a>
          <a href="/inventory" aria-current="page">
            Inventory
          </a>
        </nav>
        <div data-ui="inventory-rail-note">
          <span>Wave 0</span>
          <p>Generated from public exports, compatibility exports, catalogue specimens and tests.</p>
        </div>
      </aside>

      <div data-ui="inventory-main">
        <header data-ui="inventory-hero">
          <p data-ui="catalogue-kicker">Governance / component registry</p>
          <h1>Design-system inventory</h1>
          <p>
            One review surface for deciding what stays public, what moves out of compatibility, and what must
            remain a domain composition.
          </p>
          <div data-ui="inventory-revision">
            <span>Deterministic snapshot</span>
            <code>{designSystemInventory.schemaVersion}</code>
          </div>
        </header>

        <section data-ui="inventory-summary" aria-label="Inventory summary">
          <article>
            <span>Public exports</span>
            <strong>{String(designSystemInventory.summary.publicExports)}</strong>
            <small>{String(designSystemInventory.summary.runtimeExports)} runtime</small>
          </article>
          <article>
            <span>Compatibility</span>
            <strong>{String(designSystemInventory.summary.compatibilityModules)}</strong>
            <small>{String(designSystemInventory.summary.compatibilityExports)} exports</small>
          </article>
          <article data-emphasis={designSystemInventory.summary.publicGaps > 0 ? 'warning' : 'positive'}>
            <span>Coverage gaps</span>
            <strong>{String(designSystemInventory.summary.publicGaps)}</strong>
            <small>specimen or test posture</small>
          </article>
          <article>
            <span>Planned catalog</span>
            <strong>{String(designSystemInventory.summary.plannedComponents)}</strong>
            <small>new component contracts</small>
          </article>
        </section>

        <section data-ui="inventory-section" id="decisions">
          <header data-ui="inventory-section-head">
            <div>
              <p data-ui="catalogue-kicker">Admission decisions</p>
              <h2>What happens to each capability</h2>
            </div>
            <p>Counts include runtime and type exports. Use the registry below for the owning source.</p>
          </header>
          <div data-ui="inventory-decisions">
            {each(
              inventoryDecisions.filter((item) => item !== 'all'),
              (item) => item,
              (item) => (
                <a
                  href={`/inventory?scope=${scope}&kind=${kind}&decision=${item}`}
                  data-decision={item}
                  aria-current={decision === item ? 'page' : null}
                >
                  <span>{label(item)}</span>
                  <strong>{String(countBy(item))}</strong>
                </a>
              ),
            )}
          </div>
        </section>

        <section data-ui="inventory-section" id="registry">
          <header data-ui="inventory-section-head">
            <div>
              <p data-ui="catalogue-kicker">Export registry</p>
              <h2>{String(rows.length)} entries in this view</h2>
            </div>
            <a href="/inventory">Reset filters</a>
          </header>
          <form data-ui="inventory-filters" action="/inventory" method="get">
            <label>
              <span>Search</span>
              <input name="q" value={props.query ?? ''} placeholder="Component, owner, source or task" />
            </label>
            <label>
              <span>Scope</span>
              <select name="scope">
                {each(
                  inventoryScopes,
                  (item) => item,
                  (item) => (
                    <option value={item} selected={scope === item}>
                      {label(item)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>Export</span>
              <select name="kind">
                {each(
                  inventoryKinds,
                  (item) => item,
                  (item) => (
                    <option value={item} selected={kind === item}>
                      {label(item)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>Decision</span>
              <select name="decision">
                {each(
                  inventoryDecisions,
                  (item) => item,
                  (item) => (
                    <option value={item} selected={decision === item}>
                      {label(item)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button type="submit">Apply</button>
          </form>

          <div data-ui="inventory-table-wrap">
            <table data-ui="inventory-table">
              <thead>
                <tr>
                  <th scope="col">Export</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Owner / target</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {each(
                  rows,
                  (row) => `${row.scope}:${row.kind}:${row.name}`,
                  (row) => (
                    <tr>
                      <th scope="row">
                        <code>{row.name}</code>
                        <span>
                          {label(row.scope)} · {label(row.kind)} · {row.maturity}
                        </span>
                      </th>
                      <td data-label="Decision">
                        <span data-ui="inventory-chip" data-decision={row.decision}>
                          {label(row.decision)}
                        </span>
                        <small>Wave {String(row.wave)}</small>
                      </td>
                      <td data-label="Owner / target">
                        <strong>{row.owner}</strong>
                        <span>{row.target}</span>
                        {row.consumers > 0 && <small>{String(row.consumers)} public consumers</small>}
                      </td>
                      <td data-label="Evidence">
                        <span data-state={row.specimen}>Specimen: {statusLabel(row.specimen)}</span>
                        <span data-state={row.tests}>Tests: {statusLabel(row.tests)}</span>
                        <code>{row.gapTask}</code>
                      </td>
                      <td data-label="Source">
                        <code>{row.source}</code>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section data-ui="inventory-section" id="delivery">
          <header data-ui="inventory-section-head">
            <div>
              <p data-ui="catalogue-kicker">Runtime boundary</p>
              <h2>CSS and JavaScript delivery</h2>
            </div>
          </header>
          <div data-ui="inventory-delivery">
            <article>
              <span>01 / CSS</span>
              <h3>Component-owned source, one production entry</h3>
              <p>
                Components own their selectors beside their renderers. The package continues to ship one
                ordered stylesheet; compatibility CSS loads after it until inventory proves zero consumers.
              </p>
            </article>
            <article>
              <span>02 / SSR</span>
              <h3>Useful before JavaScript arrives</h3>
              <p>
                Native links, forms, details and server-owned URL state are the default. Renderers never
                require a browser runtime to produce valid HTML.
              </p>
            </article>
            <article>
              <span>03 / Enhancement</span>
              <h3>Behavior and islands stay explicit</h3>
              <p>
                Document-wide behavior handles shared focus and dismissal. Stateful widgets mount through
                typed islands; the design-system root does not hydrate as one application.
              </p>
            </article>
          </div>
        </section>

        <section data-ui="inventory-section" id="css">
          <header data-ui="inventory-section-head">
            <div>
              <p data-ui="catalogue-kicker">Selector ownership</p>
              <h2>Stylesheet ledger</h2>
            </div>
            <p>Compatibility files remain visible until their consumers reach zero.</p>
          </header>
          <div data-ui="inventory-css-grid">
            {each(
              designSystemInventory.cssFiles,
              (file) => file.file,
              (file) => (
                <article data-layer={file.layer}>
                  <span>{file.layer}</span>
                  <code>{file.file}</code>
                  <small>
                    {String(file.lines)} lines · {String(file.hooks.length)} hooks
                  </small>
                </article>
              ),
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
