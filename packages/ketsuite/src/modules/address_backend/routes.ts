import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { seeOther } from '../backend/forms.ts'
import { catalogsScreen, countryScreen } from './screens.tsx'
import type { CatalogRow, DivisionRow } from './screens.tsx'

type Req = Parameters<Route>[1]
type AnyRow = Record<string, unknown>
const localeQuery = (url: URL): string =>
  url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : ''
const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}
const frameFor = async (ctx: ServeContext, url: URL, req: Req) => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  menuFilter: url.searchParams.get('menu')?.trim() || null,
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})
const document = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  title: string,
  body: Parameters<ServeContext['document']>[0]['body'],
) => backendPage(ctx, req, { lang: ctx.localeOf(url, req), title, body })

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
      const _ = ctx.translate(ctx.localeOf(url, req))
      return document(
        ctx,
        url,
        req,
        _('address_backend.title'),
        catalogsScreen(_, await catalogRows(ctx, url, req), await frameFor(ctx, url, req), localeQuery(url)),
      )
    },

  '/admin/addresses/{countryCode}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
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
      return document(
        ctx,
        url,
        req,
        countryCode,
        countryScreen(
          _,
          { countryCode, status, divisions, parent },
          await frameFor(ctx, url, req),
          localeQuery(url),
        ),
      )
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
