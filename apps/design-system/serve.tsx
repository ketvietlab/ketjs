// The smallest useful KetJS app: one route, no model, no persistent state, no domain.
// It consumes the public package exactly as another application would and renders
// every component specimen from the package-owned catalogue.

import { compose, createKetServer, document, json, page, sqliteAdapter } from '@ketvietlab/ketjs'
import { BulkActions, DataTable, ListChrome, ListPage } from '@ketvietlab/design-system'
import {
  CatalogueHead,
  CataloguePage,
  InventoryPage,
  PageSurfacePreview,
  inventoryDecisions,
  inventoryKinds,
  inventoryScopes,
  surfaceKinds,
  surfaceStates,
} from '@ketvietlab/design-system/catalogue'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemo2Routes, createDemoRoutes } from './demo.tsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const designSystemSrc = (dir: string): string => {
  const candidate = join(dir, 'packages/design-system/src')
  if (existsSync(join(candidate, 'styles.css'))) return candidate
  const parent = join(dir, '..')
  if (parent === dir) throw new Error('design-system styles were not found')
  return designSystemSrc(parent)
}
const ASSETS = designSystemSrc(HERE)
const manifest = compose([], { headless: true })
const adapter = sqliteAdapter()
await adapter.open()

const oneOf = <Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value => (value && allowed.includes(value as Value) ? (value as Value) : fallback)

const app = await createKetServer({
  manifest,
  adapter,
  assets: { prefix: '/design-system/', dir: ASSETS },
  routes: {
    ...createDemoRoutes(),
    ...createDemo2Routes(),
    '/_ket/health': () => json({ ok: true, app: 'design-system' }),
    '/specimens/bulk': (url) => {
      if (url.searchParams.has('intent'))
        return json({ ids: url.searchParams.getAll('ids'), intent: url.searchParams.get('intent') })
      return page({
        body: document({
          lang: 'en',
          title: 'Bulk selection',
          head: CatalogueHead(),
          body: (
            <div data-kv-design-system data-theme="light">
              <ListPage
                title="Bulk selection"
                controls={
                  <BulkActions
                    form="bulk-form"
                    selectedCount={1}
                    actions={[{ id: 'approve', label: 'Approve', name: 'intent', value: 'approve' }]}
                  />
                }
                body={
                  <>
                    <form id="bulk-form" action="/specimens/bulk" method="get" />
                    <DataTable
                      rows={[{ id: 'A' }, { id: 'B' }]}
                      id={(row) => row.id}
                      selection={{ form: 'bulk-form', selectedIds: ['A'] }}
                      columns={[{ key: 'id', label: 'ID', cell: (row) => row.id }]}
                    />
                    <ListChrome />
                  </>
                }
              />
            </div>
          ),
        }),
      })
    },
    '/surfaces': (url) => {
      const lang = oneOf(url.searchParams.get('lang'), ['en', 'vi'] as const, 'en')
      return page({
        body: document({
          lang,
          title: 'Page surface hierarchy',
          head: CatalogueHead(),
          body: (
            <PageSurfacePreview
              kind={oneOf(url.searchParams.get('kind'), surfaceKinds, 'record')}
              state={oneOf(url.searchParams.get('state'), surfaceStates, 'baseline')}
              theme={oneOf(url.searchParams.get('theme'), ['light', 'dark'] as const, 'light')}
              tab={oneOf(url.searchParams.get('tab'), ['details', 'activity'] as const, 'details')}
              aside={url.searchParams.get('aside') !== 'false'}
              controls={url.searchParams.get('controls') !== 'false'}
              lang={lang}
            />
          ),
        }),
      })
    },
    '/inventory': (url) =>
      page({
        body: document({
          lang: 'en',
          title: 'Design-system inventory · Két Việt',
          head: CatalogueHead(),
          body: (
            <InventoryPage
              scope={oneOf(url.searchParams.get('scope'), inventoryScopes, 'all')}
              kind={oneOf(url.searchParams.get('kind'), inventoryKinds, 'all')}
              decision={oneOf(url.searchParams.get('decision'), inventoryDecisions, 'all')}
              query={url.searchParams.get('q') ?? ''}
            />
          ),
        }),
      }),
    '/components': (url) => {
      const theme = oneOf(url.searchParams.get('theme'), ['light', 'dark', 'system'] as const, 'light')
      const density = oneOf(
        url.searchParams.get('density'),
        ['compact', 'default', 'comfortable'] as const,
        'default',
      )
      return page({
        body: document({
          lang: 'en',
          title: 'Components · Két Việt Design System',
          head: CatalogueHead(),
          body: <CataloguePage theme={theme} density={density} mode="components" path="/components" />,
        }),
      })
    },
    '/components/{groupId}': (url, _request, params) => {
      const theme = oneOf(url.searchParams.get('theme'), ['light', 'dark', 'system'] as const, 'light')
      const density = oneOf(
        url.searchParams.get('density'),
        ['compact', 'default', 'comfortable'] as const,
        'default',
      )
      return page({
        body: document({
          lang: 'en',
          title: 'Component group · Két Việt Design System',
          head: CatalogueHead(),
          body: (
            <CataloguePage
              theme={theme}
              density={density}
              groupId={params.groupId}
              path={`/components/${params.groupId}`}
            />
          ),
        }),
      })
    },
    '/': (url) => {
      const theme = oneOf(url.searchParams.get('theme'), ['light', 'dark', 'system'] as const, 'light')
      const density = oneOf(
        url.searchParams.get('density'),
        ['compact', 'default', 'comfortable'] as const,
        'default',
      )
      return page({
        body: document({
          lang: 'en',
          title: 'Két Việt Design System',
          head: CatalogueHead(),
          body: <CataloguePage theme={theme} density={density} mode="overview" path="/" />,
        }),
      })
    },
  },
})

const port = await app.listen(Number(process.env.PORT ?? 4100))
console.log(`
  Két Việt Design System

    catalogue  http://127.0.0.1:${port}
    light      http://127.0.0.1:${port}/?theme=light
    dark       http://127.0.0.1:${port}/?theme=dark
    compact    http://127.0.0.1:${port}/?density=compact
    inventory  http://127.0.0.1:${port}/inventory
    app demo   http://127.0.0.1:${port}/demo
    submenu    http://127.0.0.1:${port}/demo2

  Package source:
    ${ASSETS}
`)
