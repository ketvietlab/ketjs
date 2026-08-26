// The smallest useful KetJS app: one route, no model, no persistent state, no domain.
// It consumes the public package exactly as another application would and renders
// every component specimen from the package-owned catalogue.

import { compose, createKetServer, document, json, page, sqliteAdapter } from '@ketvietlab/ketjs'
import { CatalogueHead, CataloguePage } from '@ketvietlab/design-system/catalogue'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '../../packages/design-system/src')
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
    '/_ket/health': () => json({ ok: true, app: 'design-system' }),
    '/': (url) => {
      const theme = oneOf(url.searchParams.get('theme'), ['light', 'dark', 'system'] as const, 'dark')
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
          body: <CataloguePage theme={theme} density={density} />,
        }),
      })
    },
  },
})

const port = await app.listen(Number(process.env.PORT ?? 4100))
console.log(`
  Két Việt Design System

    catalogue  http://127.0.0.1:${port}
    dark       http://127.0.0.1:${port}/?theme=dark
    compact    http://127.0.0.1:${port}/?density=compact

  Package source:
    ${ASSETS}
`)
