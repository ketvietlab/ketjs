import { randomUUID } from 'node:crypto'
import {
  NAVIGATION_TYPE,
  encodeListState,
  fragment,
  json,
  parseListState,
  table,
  text,
  validateListState,
  withHeaders,
} from '@ketvietlab/ketjs'
import type {
  FilterOperator,
  FilterRule,
  ListState,
  RouteEntry,
  Route,
  ServeContext,
} from '@ketvietlab/ketjs'
import {
  favoriteScreen,
  PRODUCT_DETAIL_TABS,
  productDetailScreen,
  productsScreen,
  VARIANT_DETAIL_TABS,
  variantScreen,
  VIEWS,
} from './screens.tsx'
import { attributesScreen } from './attributes-screen.tsx'
import { newProductScreen } from './create-screen.tsx'
import type { ProductDetailTab, TemplateRow, VariantDetailTab, View } from './screens.tsx'
import { timezoneOf, viewerOf } from '../backend/routes.ts'
import { PAGE_SIZE, colsHref, colsOf, pager, withParam } from '../backend/paging.ts'
import type { Extras, SearchMenu, TableGroup } from '../../ui/index.ts'
import { backendPage } from '../../ui/index.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { productListSearch } from '../product/search.ts'

type MediaRow = {
  id: string
  attachmentId: string
  alt?: string | null
  primary: boolean
  attachment?: { name?: string; mimetype?: string }
}
type AnyVariant = Record<string, unknown> | null
type SavedSearchRow = {
  id: string
  name: string
  state: Partial<ListState>
  defaultKey?: string | null
}

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const localeSuffix = (url: URL): string => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}
const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}
const productTabOf = (url: URL): ProductDetailTab => {
  const asked = url.searchParams.get('tab')
  return (PRODUCT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as ProductDetailTab)
    : 'general'
}
const variantTabOf = (url: URL): VariantDetailTab => {
  const asked = url.searchParams.get('tab')
  return (VARIANT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as VariantDetailTab)
    : 'general'
}
const isProductPartial = (req: Parameters<Route>[1], scope = 'product-detail'): boolean =>
  req.headers['x-ket-partial'] === scope
const seeProduct = (id: string, url: URL, tab: ProductDetailTab = productTabOf(url)) =>
  withHeaders(text('', { status: 303 }), {
    location: inLocale(url, `/admin/products/${id}?tab=${tab}`),
  })
const seeVariant = (
  templateId: string,
  productId: string,
  url: URL,
  tab: VariantDetailTab = variantTabOf(url),
) => seeOther(inLocale(url, `/admin/products/${templateId}/variants/${productId}?tab=${tab}`))

const frameFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot':
      req.headers['x-ket-navigation'] === 'fragment-v1'
        ? undefined
        : await ctx.joint(url, req, 'backend:sidebar.foot', {
            lang: ctx.localeOf(url, req),
          }),
  },
})

const optionsFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [units, categories, attributes] = (await Promise.all([
    ctx.call('uom.listUnits', {}, url, req),
    ctx.call('product.listCategories', {}, url, req),
    ctx.call('product.listAttributes', {}, url, req),
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>]
  return {
    uoms: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
    categories: categories.map((row) => ({ value: String(row.id), label: String(row.name) })),
    attributes: attributes.map((row) => ({ value: String(row.id), label: String(row.name) })),
  }
}

const invalidErrors = (url: URL, _: ReturnType<ServeContext['translate']>) =>
  url.searchParams.has('invalid') ? [_('product_backend.error.invalid')] : undefined

const stockEnabled = async (ctx: ServeContext, req: Parameters<Route>[1]) =>
  Boolean((await ctx.live(req)).functions['stock.configureProduct'])

const TRACKING = ['none', 'lot', 'serial'] as const
const validStockForm = (form: Record<string, string>): boolean => {
  const tracking = form.tracking || 'none'
  return (
    (TRACKING as readonly string[]).includes(tracking) && (form.isStorable === '1' || tracking === 'none')
  )
}

const configureStock = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  form: Record<string, string>,
) =>
  ctx.call(
    'stock.configureProduct',
    {
      templateId,
      isStorable: form.isStorable === '1',
      tracking: form.tracking || 'none',
    },
    url,
    req,
  )

type ProductListRow = {
  id: string
  name: string
  type: string
  categoryId: string | null
  uomId: string | null
  variants?: unknown[]
}

const templateRow = (row: ProductListRow): TemplateRow => ({
  id: row.id,
  name: row.name,
  type: row.type,
  categoryId: row.categoryId,
  uomId: row.uomId,
  variants: Array.isArray(row.variants) ? row.variants.length : 0,
})

const cloneState = (state: ListState): ListState => ({
  ...state,
  presets: [...state.presets],
  filters: [...state.filters],
  groupBy: [...state.groupBy],
  sort: [...state.sort],
  openGroups: state.openGroups.map((path) => [...path]),
  groupPages: { ...state.groupPages },
})

const keepForSearch = (url: URL): Record<string, string | string[]> => {
  const keep: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams) {
    if (['q', 'page', 'filterField', 'filterOp', 'filterValue', 'applyFilter'].includes(key)) continue
    const current = keep[key]
    keep[key] =
      current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value]
  }
  return keep
}

const customRuleOf = (url: URL, spec: ReturnType<typeof productListSearch>): FilterRule | null => {
  if (url.searchParams.get('applyFilter') !== '1') return null
  const field = spec.filterable?.find((candidate) => candidate.key === url.searchParams.get('filterField'))
  const operator = url.searchParams.get('filterOp') as FilterOperator | null
  if (!field || !operator) return null
  const raw = url.searchParams.get('filterValue') ?? ''
  const noValue = ['isTrue', 'isFalse', 'isSet', 'isNotSet'].includes(operator)
  const value = noValue
    ? undefined
    : operator === 'anyOf'
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : operator === 'between'
        ? raw.split(',').map((item) => (field.type === 'number' ? Number(item.trim()) : item.trim()))
        : field.type === 'number'
          ? Number(raw)
          : raw
  return { kind: 'rule', field: field.key, operator, ...(noValue ? {} : { value }) }
}

const productMenus = (
  _: ReturnType<ServeContext['translate']>,
  url: URL,
  state: ListState,
  spec: ReturnType<typeof productListSearch>,
  favorites: SavedSearchRow[],
): SearchMenu[] => {
  const stateHref = (change: (next: ListState) => void): string => {
    const next = cloneState(state)
    change(next)
    next.page = 1
    return encodeListState(next, url)
  }
  const presetItems = (spec.presets ?? []).map((preset) => ({
    id: `preset:${preset.key}`,
    label:
      preset.key === 'goods' || preset.key === 'service'
        ? _(`product_backend.type.${preset.key}`)
        : preset.label,
    active: state.presets.includes(preset.key),
    path: stateHref((next) => {
      next.presets = next.presets.includes(preset.key)
        ? next.presets.filter((key) => key !== preset.key)
        : [...next.presets, preset.key]
    }),
  }))
  const groupItems = (spec.groupable ?? []).map((field) => {
    const active = state.groupBy.some((group) => group.key === field.key)
    const add = (interval?: NonNullable<(typeof state.groupBy)[number]['interval']>) =>
      stateHref((next) => {
        next.groupBy = next.groupBy.filter((group) => group.key !== field.key)
        if (!active || interval) next.groupBy.push({ key: field.key, ...(interval ? { interval } : {}) })
        next.openGroups = []
      })
    return field.intervals?.length
      ? {
          id: `group:${field.key}`,
          label: field.label,
          children: field.intervals.map((interval) => ({
            id: `group:${field.key}:${interval}`,
            label: interval,
            active: state.groupBy.some((group) => group.key === field.key && group.interval === interval),
            path: add(interval),
          })),
        }
      : { id: `group:${field.key}`, label: field.label, active, path: add() }
  })
  const favoriteItems = favorites.map((favorite) => {
    const next: ListState = {
      ...cloneState(state),
      ...favorite.state,
      presets: [...(favorite.state.presets ?? [])],
      filters: [...(favorite.state.filters ?? [])],
      groupBy: [...(favorite.state.groupBy ?? [])],
      sort: [...(favorite.state.sort ?? spec.defaultSort ?? [])],
      page: 1,
      openGroups: [],
      groupPages: {},
      favoriteId: favorite.id,
    }
    return {
      id: `favorite:${favorite.id}`,
      label: `${favorite.defaultKey ? '★ ' : ''}${favorite.name}`,
      active: state.favoriteId === favorite.id,
      path: encodeListState(next, url),
    }
  })
  const returnTo = encodeListState({ ...cloneState(state), favoriteId: undefined }, url)
  const saveUrl = new URL('/admin/products/favorites/new', url)
  saveUrl.searchParams.set('returnTo', returnTo)
  const lang = url.searchParams.get('lang')
  if (lang) saveUrl.searchParams.set('lang', lang)
  return [
    {
      id: 'filters',
      label: _('backend.chrome.filters'),
      items: [
        ...presetItems,
        {
          id: 'archived',
          label: _('backend.chrome.includeArchived'),
          active: state.includeArchived,
          path: stateHref((next) => {
            next.includeArchived = !next.includeArchived
          }),
        },
      ],
      customFilter: {
        fields: (spec.filterable ?? []).map((field) => ({ value: field.key, label: field.label })),
        operators: [
          { value: 'contains', label: _('backend.chrome.operator.contains') },
          { value: 'equals', label: '=' },
          { value: 'notEquals', label: '≠' },
          { value: 'gte', label: '≥' },
          { value: 'lte', label: '≤' },
          { value: 'isSet', label: _('backend.chrome.operator.isSet') },
          { value: 'isNotSet', label: _('backend.chrome.operator.isNotSet') },
        ],
        fieldLabel: _('backend.chrome.customField'),
        operatorLabel: _('backend.chrome.customOperator'),
        valueLabel: _('backend.chrome.customValue'),
        applyLabel: _('backend.chrome.apply'),
      },
    },
    { id: 'group', label: _('backend.chrome.groupBy'), items: groupItems },
    {
      id: 'favorites',
      label: _('backend.chrome.favorites'),
      items: [
        ...favoriteItems,
        {
          id: 'favorite:new',
          label: _('product_backend.favorite.create'),
          path: `${saveUrl.pathname}${saveUrl.search}`,
        },
      ],
    },
  ]
}

const productFacets = (
  _: ReturnType<ServeContext['translate']>,
  url: URL,
  state: ListState,
  spec: ReturnType<typeof productListSearch>,
) => {
  const href = (change: (next: ListState) => void) => {
    const next = cloneState(state)
    change(next)
    next.page = 1
    return encodeListState(next, url)
  }
  return [
    ...(state.q
      ? [{ label: `${_('backend.chrome.searchFacet')}: ${state.q}`, without: href((next) => delete next.q) }]
      : []),
    ...state.presets.map((key) => ({
      label: spec.presets?.find((preset) => preset.key === key)?.label ?? key,
      without: href((next) => {
        next.presets = next.presets.filter((preset) => preset !== key)
      }),
    })),
    ...state.filters.map((filter, index) => ({
      label: filter.kind === 'rule' ? `${filter.field} ${filter.operator}` : `${filter.op.toUpperCase()} (…)`,
      without: href((next) => {
        next.filters.splice(index, 1)
      }),
    })),
    ...state.groupBy.map((group, index) => ({
      label: `${_('backend.chrome.groupBy')}: ${group.key}${group.interval ? ` / ${group.interval}` : ''}`,
      without: href((next) => {
        next.groupBy.splice(index, 1)
        next.openGroups = []
      }),
    })),
  ]
}

const pathStartsWith = (path: unknown[], prefix: unknown[]): boolean =>
  prefix.every((value, index) => JSON.stringify(path[index]) === JSON.stringify(value))

const loadProductGroups = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  state: ListState,
  timezone: string,
  labels: { categories: Map<string, string>; units: Map<string, string> },
  path: unknown[] = [],
): Promise<TableGroup<TemplateRow>[]> => {
  const groups = (await ctx.call(
    'product.groupTemplates',
    { state, path, timezone, limit: PAGE_SIZE },
    url,
    req,
  )) as Array<{ key: unknown[]; count: number }>
  const selected = state.groupBy[path.length]!
  return Promise.all(
    groups.map(async (group) => {
      const value = group.key[0]
      const nextPath = [...path, value]
      const open = state.openGroups.some(
        (candidate) => pathStartsWith(candidate, nextPath) && candidate.length === nextPath.length,
      )
      const next = cloneState(state)
      next.openGroups = open
        ? next.openGroups.filter((candidate) => !pathStartsWith(candidate, nextPath))
        : [...next.openGroups, nextPath]
      const label =
        value == null
          ? '—'
          : selected.key === 'type'
            ? ctx.translate(ctx.localeOf(url, req))(`product_backend.type.${String(value)}`)
            : selected.key === 'categoryId'
              ? (labels.categories.get(String(value)) ?? String(value))
              : selected.key === 'uomId'
                ? (labels.units.get(String(value)) ?? String(value))
                : typeof value === 'boolean'
                  ? String(value ? '✓' : '×')
                  : String(value)
      const childGroups =
        open && path.length + 1 < state.groupBy.length
          ? await loadProductGroups(ctx, url, req, state, timezone, labels, nextPath)
          : undefined
      const rows =
        open && path.length + 1 === state.groupBy.length
          ? (
              (await ctx.call(
                'product.listTemplates',
                {
                  state,
                  path: nextPath,
                  timezone,
                  withVariants: true,
                  limit: PAGE_SIZE,
                  offset: ((state.groupPages[JSON.stringify(nextPath)] ?? 1) - 1) * PAGE_SIZE,
                },
                url,
                req,
              )) as ProductListRow[]
            ).map(templateRow)
          : undefined
      const pageKey = JSON.stringify(nextPath)
      const page = state.groupPages[pageKey] ?? 1
      const pagerHref = (target: number) => {
        const paged = cloneState(state)
        if (target <= 1) delete paged.groupPages[pageKey]
        else paged.groupPages[pageKey] = target
        return encodeListState(paged, url)
      }
      const from = (page - 1) * PAGE_SIZE + 1
      const to = Math.min(page * PAGE_SIZE, Number(group.count))
      const pager =
        rows && Number(group.count) > PAGE_SIZE
          ? {
              label: `${from}-${to} / ${Number(group.count)}`,
              prev: page > 1 ? pagerHref(page - 1) : undefined,
              next: to < Number(group.count) ? pagerHref(page + 1) : undefined,
            }
          : undefined
      return {
        id: JSON.stringify(nextPath),
        label,
        count: Number(group.count),
        depth: path.length,
        open,
        href: encodeListState(next, url),
        children: childGroups,
        rows,
        pager,
      }
    }),
  )
}

const mediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], templateId: string) =>
  ctx.call('product_media.listMedia', { templateId }, url, req) as Promise<MediaRow[]>

const variantMediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], productId: string) =>
  ctx.call('product_media.listMedia', { productId }, url, req) as Promise<MediaRow[]>

const ownsMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
) => (await mediaFor(ctx, url, req, templateId)).some((row) => row.id === mediaId)

const ownsVariantMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  productId: string,
  mediaId: string,
) => (await variantMediaFor(ctx, url, req, productId)).some((row) => row.id === mediaId)

/**
 * The catalogue screen.
 *
 * A route of this module, not of backend — the bridge owns the page it links to,
 * so installing the admin without the catalogue leaves neither the entry nor the
 * page behind. Closed by default, like every module route: a stranger gets the
 * sign-in page.
 *
 * Everything the list is doing — which page, which search, which view — is in the
 * URL. Nothing here holds state between requests.
 */
export const routes: Record<string, RouteEntry> = {
  '/admin/products':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const asked = url.searchParams.get('view')
      const view: View = (VIEWS as readonly string[]).includes(asked ?? '') ? (asked as View) : 'list'
      const spec = productListSearch(table(ctx.manifest, 'product.Template'))
      const parsed = parseListState(spec, url)
      const loadedFavorites = (await ctx.callUnchecked(
        'backend.listSavedSearches',
        { listKey: spec.key },
        url,
        req,
      )) as SavedSearchRow[]
      const favorites = loadedFavorites.filter((favorite) => {
        try {
          validateListState(spec, {
            ...cloneState(parsed.state),
            ...favorite.state,
            presets: [...(favorite.state.presets ?? [])],
            filters: [...(favorite.state.filters ?? [])],
            groupBy: [...(favorite.state.groupBy ?? [])],
            sort: [...(favorite.state.sort ?? spec.defaultSort ?? [])],
          })
          return true
        } catch {
          return false
        }
      })
      const hasExpandedState = ['q', 'preset', 'filter', 'group', 'sort', 'archived'].some((key) =>
        url.searchParams.has(key),
      )
      const selectedFavorite = favorites.find((favorite) => favorite.id === parsed.state.favoriteId)
      const defaultFavorite = favorites.find((favorite) => favorite.defaultKey)
      const favoriteToExpand = !hasExpandedState
        ? (selectedFavorite ?? (!url.searchParams.has('favorite') ? defaultFavorite : undefined))
        : undefined
      if (favoriteToExpand) {
        const next: ListState = {
          ...cloneState(parsed.state),
          ...favoriteToExpand.state,
          presets: [...(favoriteToExpand.state.presets ?? [])],
          filters: [...(favoriteToExpand.state.filters ?? [])],
          groupBy: [...(favoriteToExpand.state.groupBy ?? [])],
          sort: [...(favoriteToExpand.state.sort ?? spec.defaultSort ?? [])],
          page: 1,
          openGroups: [],
          groupPages: {},
          favoriteId: favoriteToExpand.id,
        }
        return withHeaders(text('', { status: 303 }), { location: encodeListState(next, url) })
      }
      const customRule = customRuleOf(url, spec)
      if (customRule) {
        const next = cloneState(parsed.state)
        next.filters.push(customRule)
        next.page = 1
        const clean = new URL(url)
        for (const key of ['filterField', 'filterOp', 'filterValue', 'applyFilter'])
          clean.searchParams.delete(key)
        return withHeaders(text('', { status: 303 }), { location: encodeListState(next, clean) })
      }
      const state = parsed.state
      const current = state.page
      const timezone = await timezoneOf(ctx, url, req)
      const grouped = view === 'list' && state.groupBy.length > 0
      const rows = grouped
        ? []
        : ((await ctx.call(
            'product.listTemplates',
            {
              state,
              timezone,
              withVariants: true,
              limit: PAGE_SIZE,
              offset: (current - 1) * PAGE_SIZE,
            },
            url,
            req,
          )) as ProductListRow[])
      const { count } = (await ctx.call('product.countTemplates', { state, timezone }, url, req)) as {
        count: number
      }
      const [categoryRows, unitRows] = (await Promise.all([
        state.groupBy.some((group) => group.key === 'categoryId')
          ? ctx.call('product.listCategories', {}, url, req)
          : Promise.resolve([]),
        state.groupBy.some((group) => group.key === 'uomId')
          ? ctx.call('uom.listUnits', {}, url, req)
          : Promise.resolve([]),
      ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
      const categoryMap = new Map<string, string>()
      const collectCategories = (items: Array<Record<string, unknown>>) => {
        for (const item of items) {
          categoryMap.set(String(item.id), String(item.name))
          if (Array.isArray(item.children)) collectCategories(item.children as Array<Record<string, unknown>>)
        }
      }
      collectCategories(categoryRows)
      const groups = grouped
        ? await loadProductGroups(ctx, url, req, state, timezone, {
            categories: categoryMap,
            units: new Map(unitRows.map((row) => [String(row.id), String(row.name)])),
          })
        : undefined

      const extras: Extras = {
        'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
        'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
        'sidebar.foot':
          req.headers['x-ket-navigation'] === 'fragment-v1'
            ? undefined
            : await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
      }
      return backendPage(ctx, req, {
        lang,
        title: 'KetSuite',
        body: productsScreen(
          _,
          rows.map(templateRow),
          view,
          {
            navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
            viewer: await viewerOf(ctx, url, req),
            extras,
            menu: await ctx.menu(url, req),
            menuFilter: url.searchParams.get('menu')?.trim() || null,
            chrome: {
              create: {
                label: _('product_backend.action.create'),
                path: inLocale(url, '/admin/products/new'),
              },
              search: {
                name: 'q',
                value: state.q ?? '',
                placeholder: _('product_backend.chrome.search'),
                keep: keepForSearch(url),
                facets: productFacets(_, url, state, spec),
                menus: productMenus(_, url, state, spec, favorites),
              },
              pager: grouped ? null : pager(url, current, rows.length, count),
              views: VIEWS.map((v) => ({
                id: v,
                label: _(`backend.chrome.view.${v}`),
                icon: v === 'kanban' ? 'layout-grid' : 'list',
                path: withParam(url, 'view', v),
                active: v === view,
              })),
            },
          },
          { shown: colsOf(url), colsHref: colsHref(url), groups },
          localeSuffix(url),
        ),
      })
    },
  '/admin/products/favorites/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const form = req.method === 'POST' ? await readForm(req) : null
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const rawReturn = form?.returnTo ?? url.searchParams.get('returnTo') ?? '/admin/products'
      const source = new URL(rawReturn, 'http://ket.local')
      const returnTo =
        source.pathname === '/admin/products' ? `${source.pathname}${source.search}` : '/admin/products'
      if (req.method === 'POST') {
        const spec = productListSearch(table(ctx.manifest, 'product.Template'))
        const state = parseListState(spec, new URL(returnTo, 'http://ket.local')).state
        const id = randomUUID()
        const result = (await ctx.callUnchecked(
          'backend.saveSavedSearch',
          {
            id,
            listKey: spec.key,
            name: form?.name ?? '',
            state,
            default: form?.default === '1',
          },
          url,
          req,
        )) as { ok?: boolean }
        if (result.ok) {
          state.favoriteId = id
          return seeOther(encodeListState(state, new URL(returnTo, 'http://ket.local')))
        }
        return backendPage(ctx, req, {
          lang,
          title: _('product_backend.favorite.create'),
          body: favoriteScreen(_, await frameFor(ctx, url, req), returnTo, localeSuffix(url), [
            _('product_backend.favorite.invalid'),
          ]),
        })
      }
      return backendPage(ctx, req, {
        lang,
        title: _('product_backend.favorite.create'),
        body: favoriteScreen(_, await frameFor(ctx, url, req), returnTo, localeSuffix(url)),
      })
    },
  '/admin/products/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const hasStock = await stockEnabled(ctx, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (hasStock && !validStockForm(form))
          return seeOther(inLocale(url, '/admin/products/new?invalid=1&count=1'))
        const id = randomUUID()
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id,
            name: form.name ?? '',
            type: form.type || 'goods',
            ...(form.uomId ? { uomId: form.uomId } : {}),
            ...(form.categoryId ? { categoryId: form.categoryId } : {}),
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
          },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/products/new?invalid=1&count=${errorsOf(result).length}`))
        if (hasStock) {
          const stockResult = await configureStock(ctx, url, req, id, form)
          if (!(stockResult as { ok?: boolean }).ok)
            return seeOther(
              inLocale(url, `/admin/products/${id}?invalid=1&count=${errorsOf(stockResult).length}`),
            )
        }
        return seeProduct(id, url)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const options = await optionsFor(ctx, url, req)
      return backendPage(ctx, req, {
        lang,
        title: _('product_backend.create.title'),
        body: newProductScreen(
          _,
          { ...options, stockEnabled: hasStock, errors: invalidErrors(url, _) },
          await frameFor(ctx, url, req),
          localeSuffix(url),
        ),
      })
    },
  '/admin/product-attributes':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const name = form.name?.trim()
        if (!name) return seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
        const result = await ctx.call(
          'product.saveAttribute',
          {
            id: randomUUID(),
            name,
            sequence: Number(form.sequence || 10),
            displayType: form.displayType || 'radio',
            createVariant: form.createVariant || 'always',
            active: true,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/product-attributes'))
          : seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('product.listAttributes', {}, url, req)) as Array<Record<string, unknown>>
      return backendPage(ctx, req, {
        lang,
        title: _('product_backend.attributes.title'),
        body: attributesScreen(
          _,
          rows,
          await frameFor(ctx, url, req),
          invalidErrors(url, _),
          localeSuffix(url),
        ),
      })
    },
  '/admin/product-attributes/{id}/values':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const name = form.name?.trim()
      if (!name) return seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
      const result = await ctx.call(
        'product.saveAttributeValue',
        {
          id: randomUUID(),
          attributeId: params.id,
          name,
          sequence: Number(form.sequence || 10),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, '/admin/product-attributes'))
        : seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
    },
  '/admin/products/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const hasStock = await stockEnabled(ctx, req)
      const activeTab = productTabOf(url)
      let savedPartial = false
      if (req.method === 'POST') {
        const partial = isProductPartial(req)
        const form = await readForm(req)
        if (hasStock && !validStockForm(form)) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: ['tracking'] },
              { status: 422 },
            )
          return seeOther(inLocale(url, `/admin/products/${params.id}?invalid=1&count=1`))
        }
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id: params.id,
            name: form.name ?? '',
            type: form.type || 'goods',
            ...(form.uomId ? { uomId: form.uomId } : {}),
            ...(form.categoryId ? { categoryId: form.categoryId } : {}),
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
          },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(result) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}?invalid=1&count=${errorsOf(result).length}`),
          )
        }
        if (hasStock) {
          const stockResult = await configureStock(ctx, url, req, params.id, form)
          if (!(stockResult as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(stockResult),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(url, `/admin/products/${params.id}?invalid=1&count=${errorsOf(stockResult).length}`),
            )
          }
        }
        if (!partial) return seeProduct(params.id, url)
        savedPartial = true
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
      const row = (await ctx.call('product.getTemplate', { id: params.id }, url, req)) as {
        id: string
        name: string
        type: string
        description?: string | null
        listPrice: number
        uomId: string | null
        categoryId?: string | null
        saleOk?: boolean
        purchaseOk?: boolean
      } | null
      if (!row) return text('Product not found', { status: 404 })
      const [mediaRows, variants, options, stockConfig] = await Promise.all([
        mediaFor(ctx, url, req, row.id),
        ctx.call('product.listVariants', { templateId: row.id }, url, req) as Promise<
          Array<{ id: string; defaultCode?: string | null; barcode?: string | null; active?: boolean }>
        >,
        optionsFor(ctx, url, req),
        hasStock
          ? ctx.call('stock.getProductConfig', { templateId: row.id }, url, req)
          : Promise.resolve(null),
      ])
      const body = productDetailScreen(
        _,
        { ...row, ...(stockConfig as Record<string, unknown> | null) },
        {
          status: 'ready',
          uploadAction: inLocale(url, `/admin/products/${row.id}/media?tab=media`),
          uploadControl: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:media.upload', {
                identity: `template:${row.id}`,
                action: inLocale(url, `/admin/products/${row.id}/media?tab=media`),
                label: _('product_backend.media.add'),
              }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: `/files/${image.attachmentId}`,
            alt: image.alt || image.attachment?.name || row.name,
            primary: image.primary,
            actions: {
              primary: inLocale(url, `/admin/products/${row.id}/media/${image.id}/primary?tab=media`),
              remove: inLocale(url, `/admin/products/${row.id}/media/${image.id}/remove?tab=media`),
              ...(index > 0
                ? {
                    moveUp: inLocale(url, `/admin/products/${row.id}/media/${image.id}/move-up?tab=media`),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/products/${row.id}/media/${image.id}/move-down?tab=media`,
                    ),
                  }
                : {}),
            },
          })),
          extension: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:template.media', {
                templateId: row.id,
              }),
        },
        {
          ...options,
          variants,
          stockEnabled: hasStock,
          errors: invalidErrors(url, _),
          editor: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:template.editor', {
                identity: `template:${row.id}`,
                templateId: row.id,
                lang,
              }),
        },
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:template.collaboration', {
              resModel: 'product.Template',
              resId: row.id,
              lang,
            }),
        savedPartial ? {} : await frameFor(ctx, url, req),
        localeSuffix(url),
        activeTab,
        savedPartial,
      )
      if (savedPartial)
        return withHeaders(fragment(body, { type: NAVIGATION_TYPE }), { vary: 'X-Ket-Partial' })
      return backendPage(ctx, req, {
        lang,
        title: row.name,
        body,
      })
    },
  '/admin/products/{id}/variants/generate':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const result = await ctx.call('product.generateVariants', { templateId: params.id }, url, req)
      return (result as { ok?: boolean }).ok
        ? seeProduct(params.id, url)
        : seeOther(inLocale(url, `/admin/products/${params.id}?invalid=1`))
    },
  '/admin/products/{id}/attribute-lines':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const attributeId = form.attributeId ?? ''
      const result = await ctx.call(
        'product.saveAttributeLine',
        {
          id: `${params.id}:${attributeId}`,
          templateId: params.id,
          attributeId,
          valueIds: (form.valueIds ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeProduct(params.id, url)
        : seeOther(inLocale(url, `/admin/products/${params.id}?invalid=1`))
    },
  '/admin/products/{id}/variants/{variantId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const activeTab = variantTabOf(url)
      const existing = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as Record<
        string,
        unknown
      > | null
      if (!existing || existing.templateId !== params.id) return text('Variant not found', { status: 404 })
      let savedPartial = false
      if (req.method === 'POST') {
        const partial = isProductPartial(req, 'product-variant')
        const form = await readForm(req)
        const saved = await ctx.call(
          'product.saveVariant',
          {
            id: params.variantId,
            templateId: params.id,
            defaultCode: form.defaultCode || null,
            barcode: form.barcode || null,
            weight: form.weight || '0',
            volume: form.volume || '0',
          },
          url,
          req,
        )
        if (!(saved as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(saved) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        const cost = await ctx.call(
          'product.setCost',
          { productId: params.variantId, standardPrice: form.standardPrice || '0' },
          url,
          req,
        )
        if (!(cost as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(cost) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        if (form.uomId) {
          const productUom = await ctx.call(
            'product.addProductUom',
            { productId: params.variantId, uomId: form.uomId, barcode: form.uomBarcode || null },
            url,
            req,
          )
          if (!(productUom as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(productUom),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
            )
          }
        }
        if (!partial) return seeVariant(params.id, params.variantId, url, activeTab)
        savedPartial = true
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
      const [current, template, options, mediaRows] = await Promise.all([
        ctx.call('product.getVariant', { id: params.variantId }, url, req) as Promise<Record<
          string,
          unknown
        > | null>,
        ctx.call('product.getTemplate', { id: params.id }, url, req) as Promise<{
          id: string
          name: string
        } | null>,
        optionsFor(ctx, url, req),
        variantMediaFor(ctx, url, req, params.variantId),
      ])
      if (!current || current.templateId !== params.id || !template)
        return text('Variant not found', { status: 404 })
      const body = variantScreen(
        _,
        params.id,
        current,
        {
          status: 'ready',
          uploadAction: inLocale(
            url,
            `/admin/products/${params.id}/variants/${params.variantId}/media?tab=media`,
          ),
          uploadControl: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:media.upload', {
                identity: `variant:${params.variantId}`,
                action: inLocale(
                  url,
                  `/admin/products/${params.id}/variants/${params.variantId}/media?tab=media`,
                ),
                label: _('product_backend.media.add'),
              }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: `/files/${image.attachmentId}`,
            alt: image.alt || image.attachment?.name || String(current.defaultCode || current.id),
            primary: image.primary,
            actions: {
              primary: inLocale(
                url,
                `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/primary?tab=media`,
              ),
              remove: inLocale(
                url,
                `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/remove?tab=media`,
              ),
              ...(index > 0
                ? {
                    moveUp: inLocale(
                      url,
                      `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-up?tab=media`,
                    ),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-down?tab=media`,
                    ),
                  }
                : {}),
            },
          })),
          extension: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:variant.media', {
                productId: params.variantId,
              }),
        },
        options.uoms,
        template,
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:variant.collaboration', {
              resModel: 'product.Product',
              resId: params.variantId,
              lang,
            }),
        savedPartial ? {} : await frameFor(ctx, url, req),
        invalidErrors(url, _),
        localeSuffix(url),
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:variant.editor', {
              identity: `variant:${params.variantId}`,
              productId: params.variantId,
              lang,
            }),
        activeTab,
        savedPartial,
      )
      if (savedPartial)
        return withHeaders(fragment(body, { type: NAVIGATION_TYPE }), { vary: 'X-Ket-Partial' })
      return backendPage(ctx, req, {
        lang,
        title: String(current.defaultCode || current.id),
        body,
      })
    },
  '/admin/products/{id}/variants/{variantId}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
      const variant = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as AnyVariant
      if (!variant || variant.templateId !== params.id) return text('Variant not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Product',
        resId: params.variantId,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            productId: params.variantId,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, -1),
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, 1),
  '/admin/products/{id}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
      const template = await ctx.call('product.getTemplate', { id: params.id }, url, req)
      if (!template) return text('Product not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Template',
        resId: params.id,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            templateId: params.id,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeProduct(params.id, url)
    },
  '/admin/products/{id}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/products/{id}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/products/{id}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, -1),
  '/admin/products/{id}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, 1),
}

const move = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const rows = await mediaFor(ctx, url, req, templateId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { templateId, ids }, url, req)
  }
  return seeProduct(templateId, url)
}

const moveVariant = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  productId: string,
  mediaId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const rows = await variantMediaFor(ctx, url, req, productId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { productId, ids }, url, req)
  }
  return seeVariant(templateId, productId, url)
}
