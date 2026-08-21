import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { seeOther } from '../backend/forms.ts'
import { catalogsScreen, countryScreen } from './screens.tsx'
import type { CatalogRow, DivisionRow } from './screens.tsx'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

const catalogRows = async (ctx: ServeContext, url: URL, req: Req): Promise<CatalogRow[]> => {
  const [available, statuses] = await Promise.all([
    ctx.call('address.availableCatalogs', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('address.catalogStatus', {}, url, req) as Promise<AnyRow[]>,
  ])
  const status = new Map(statuses.map((row) => [String(row.countryId), row]))
  return available.map((row) => {
    const installed = status.get(String(row.countryCode))
    return {
      countryCode: String(row.countryCode),
      version: String(row.version),
      recommended: Boolean(row.recommended),
      installed: installed?.status === 'active',
      status: installed?.status ? String(installed.status) : null,
      recordCount: installed?.recordCount == null ? null : Number(installed.recordCount),
      codeSystem: installed?.codeSystem ? String(installed.codeSystem) : null,
      effectiveFrom: installed?.effectiveFrom ? String(installed.effectiveFrom) : null,
    }
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/addresses':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const rows = await catalogRows(ctx, url, req)
      return adminPage(ctx, url, req, {
        title: 'address_backend.title',
        body: (_, frame) => catalogsScreen(_, rows, frame, localeQuery(url)),
      })
    },

  '/admin/addresses/{countryCode}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const countryCode = params.countryCode.toUpperCase()
      const rows = await catalogRows(ctx, url, req)
      const status = rows.find((row) => row.countryCode === countryCode) ?? null
      let divisions: DivisionRow[] = []
      let parent: DivisionRow | null = null
      const parentId = url.searchParams.get('parentId')
      if (status?.installed) {
        divisions = (await ctx.call(
          'address.listDivisionChildren',
          { countryCode, parentId: parentId || null, limit: 1000 },
          url,
          req,
        )) as DivisionRow[]
        if (parentId) {
          const path = (await ctx.call(
            'address.resolveDivisionPath',
            { id: parentId },
            url,
            req,
          )) as DivisionRow[]
          parent = path.at(-1) ?? null
        }
      }
      return adminPage(ctx, url, req, {
        title: countryCode,
        translate: false,
        body: (_, frame) =>
          countryScreen(_, { countryCode, status, divisions, parent }, frame, localeQuery(url)),
      })
    },

  '/admin/addresses/{countryCode}/install':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
      const version = new URLSearchParams(body).get('action') || undefined
      const result = (await ctx.call(
        'address.installCatalog',
        { countryCode: params.countryCode, version },
        url,
        req,
      )) as { ok?: boolean; errors?: unknown }
      if (!result.ok) return text(JSON.stringify(result.errors ?? []), { status: 400 })
      return seeOther(inLocale(url, `/admin/addresses/${params.countryCode.toUpperCase()}`))
    },
}
