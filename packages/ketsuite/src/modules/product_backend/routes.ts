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
  attributesScreen,
  favoriteModal,
  newProductScreen,
  PRODUCT_DETAIL_TABS,
  productDetailScreen,
  productsScreen,
  VARIANT_DETAIL_TABS,
  variantScreen,
  VIEWS,
} from './screens/index.ts'
import {
  attributeControl,
  attributeValuesControl,
  brandControl,
  categoryControl,
  uomControl,
} from './relation-control.ts'
import type { ProductDetailTab, TemplateRow, VariantDetailTab, View } from './screens/index.ts'
import { PAGE_SIZE, colsHref, colsOf, pager, withParam } from '../backend/paging.ts'
import type { SearchMenu, TableGroup, TableSelection } from '../../ui/index.ts'
import { backendPage, modalWorkspace } from '../../ui/index.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { productListSearch } from '../product/search.ts'
import { adminPage, frameOf, inLocale, localeQuery, timezoneOf } from '../backend/screen.ts'

type MediaRow = {
  id: string
  attachmentId: string
  templateId?: string | null
  productId?: string | null
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

/**
 * The two things every mutating route here has to establish before it reads a form.
 *
 * The admin authenticates with a session cookie, so a POST that arrives from
 * another origin carries the signed-in user's credentials without their intent —
 * which is why every write in this module refuses one, the same way user_backend,
 * company_backend and oauth_backend do.
 */
const refusePost = (req: Parameters<Route>[1], accepts = 'POST') =>
  req.method !== 'POST'
    ? text(accepts, { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

const productTabOf = (url: URL): ProductDetailTab => {
  const asked = url.searchParams.get('tab')
  return (PRODUCT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as ProductDetailTab)
    : 'general'
}
const MEDIA_VARIANT_PAGE_SIZE = 25
const VARIANT_PAGE_SIZE = 10
const positivePage = (value: string | null): number => {
  const page = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}
const requestedVariantMediaPage = (url: URL): number => {
  return positivePage(url.searchParams.get('variantPage'))
}
const requestedVariantPage = (url: URL): number => positivePage(url.searchParams.get('page'))
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
    location: inLocale(url, `/admin/product/templates/${id}?tab=${tab}`),
  })
const seeVariant = (
  templateId: string,
  productId: string,
  url: URL,
  tab: VariantDetailTab = variantTabOf(url),
) => seeOther(inLocale(url, `/admin/product/templates/${templateId}/variants/${productId}?tab=${tab}`))

const optionsFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const live = await ctx.live(req)
  const taxEnabled = Boolean(live.functions['account.listTaxes'])
  const [units, categories, attributes, brands, taxes] = (await Promise.all([
    ctx.call('uom.listUnits', {}, url, req),
    ctx.call('product.listCategories', {}, url, req),
    ctx.call('product.listAttributes', {}, url, req),
    ctx.call('product.listBrands', {}, url, req),
    taxEnabled ? ctx.call('account.listTaxes', { typeTaxUse: 'sale' }, url, req) : Promise.resolve([]),
  ])) as [
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
  ]
  const variantAttributes = attributes.filter((row) => row.createVariant !== 'no_variant')
  return {
    // Kept raw alongside the options so a caller can reach `parentPath` and work
    // out which unit tree a template sits in.
    unitRows: units,
    uoms: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
    categories: categories.map((row) => ({
      value: String(row.id),
      label: String(row.name),
      // The ancestry, so two "Shirts" under different parents stay distinguishable.
      description: row.path == null ? null : String(row.path),
    })),
    brands: brands.map((row) => ({ value: String(row.id), label: String(row.name) })),
    taxes: taxes.map((row) => ({ value: String(row.id), label: String(row.name) })),
    taxEnabled,
    variantAttributes: variantAttributes.map((row) => ({
      value: String(row.id),
      label: String(row.name),
    })),
    // Values come nested inside their attribute here, and carry the attribute's
    // name as their description — the value picker spans every attribute, so
    // "Đỏ" on its own would not say which attribute it belongs to.
    attributeValues: variantAttributes.flatMap((attribute) =>
      (Array.isArray(attribute.values) ? (attribute.values as Array<Record<string, unknown>>) : []).map(
        (value) => ({
          value: String(value.id),
          label: String(value.name),
          description: String(attribute.name),
        }),
      ),
    ),
  }
}

/**
 * The root of the unit tree a template's default unit belongs to.
 *
 * A variant's unit is refused unless it shares this root, so the picker is given
 * the root and offers nothing that would be rejected.
 */
const unitRootOf = (units: Array<Record<string, unknown>>, uomId: unknown): string | null => {
  if (uomId == null) return null
  const unit = units.find((row) => String(row.id) === String(uomId))
  return unit ? (String(unit.parentPath).split('/').filter(Boolean)[0] ?? null) : null
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
  listPrice: number
  variants?: unknown[]
}

const templateRow = (row: ProductListRow): TemplateRow => ({
  id: row.id,
  name: row.name,
  type: row.type,
  categoryId: row.categoryId,
  uomId: row.uomId,
  listPrice: row.listPrice,
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
  const saveUrl = new URL(returnTo, url)
  saveUrl.searchParams.set('modal', 'favorite')
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
  labels: {
    categories: Map<string, string>
    units: Map<string, string>
    /** Names and thumbnails for a group's rows, batched the same way a page is. */
    decorate: (rows: ProductListRow[]) => Promise<TemplateRow[]>
  },
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
          ? await labels.decorate(
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
              )) as ProductListRow[],
            )
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
  '/admin/product/templates':
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
      // The names are needed by every row, not only by a group header: a table
      // that prints a category id where it means a category name is showing its
      // own plumbing.
      const [categoryRows, unitRows] = (await Promise.all([
        ctx.call('product.listCategories', {}, url, req),
        ctx.call('uom.listUnits', {}, url, req),
      ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
      const categoryMap = new Map<string, string>()
      const collectCategories = (items: Array<Record<string, unknown>>) => {
        for (const item of items) {
          categoryMap.set(String(item.id), String(item.name))
          if (Array.isArray(item.children)) collectCategories(item.children as Array<Record<string, unknown>>)
        }
      }
      collectCategories(categoryRows)
      const unitMap = new Map(unitRows.map((row) => [String(row.id), String(row.name)]))
      const canReadStock = Boolean((await ctx.live(req)).functions['stock.listProductConfigs'])
      /** One media call per batch of rows, whether that batch is a page or a group. */
      const decorate = async (batch: ProductListRow[]): Promise<TemplateRow[]> => {
        if (!batch.length) return []
        const templateIds = batch.map((row) => row.id)
        const [media, stockConfigs] = (await Promise.all([
          ctx.call('product_media.listPrimaryMedia', { templateIds }, url, req),
          canReadStock
            ? ctx.call('stock.listProductConfigs', { templateIds }, url, req)
            : Promise.resolve([]),
        ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
        const images = new Map(media.map((row) => [String(row.templateId), String(row.attachmentId)]))
        const inventory = new Map(
          stockConfigs.map((row) => [String(row.templateId), Boolean(row.isStorable)]),
        )
        return batch.map((row) => {
          const attachmentId = images.get(String(row.id))
          return {
            ...templateRow(row),
            uomName: row.uomId ? (unitMap.get(String(row.uomId)) ?? null) : null,
            categoryName: row.categoryId ? (categoryMap.get(String(row.categoryId)) ?? null) : null,
            isStorable: canReadStock ? (inventory.get(String(row.id)) ?? false) : null,
            image: attachmentId ? { src: `/files/${attachmentId}`, alt: row.name } : null,
          }
        })
      }
      const decoratedRows = await decorate(rows)
      const groups = grouped
        ? await loadProductGroups(ctx, url, req, state, timezone, {
            categories: categoryMap,
            units: unitMap,
            decorate,
          })
        : undefined
      const selection: TableSelection | undefined =
        view === 'list'
          ? {
              formId: 'product-template-bulk',
              action: inLocale(url, '/admin/product/templates/bulk'),
              hidden: { returnTo: `${url.pathname}${url.search}` },
              actions: [
                { id: 'archive', label: _('backend.chrome.archive') },
                { id: 'delete', label: _('backend.chrome.delete'), tone: 'danger' },
              ],
            }
          : undefined

      return adminPage(ctx, url, req, {
        title: 'KetSuite',
        translate: false,
        body: (_, frame) => {
          const workspace = productsScreen(
            _,
            decoratedRows,
            view,
            {
              ...frame,
              chrome: {
                create: {
                  label: _('product_backend.action.create'),
                  path: inLocale(url, '/admin/product/templates/new'),
                },
                selection,
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
            { shown: colsOf(url), colsHref: colsHref(url), groups, selection },
            localeQuery(url),
            count,
          )
          if (url.searchParams.get('modal') !== 'favorite') return workspace
          const returnUrl = new URL(url)
          returnUrl.searchParams.delete('modal')
          returnUrl.searchParams.delete('favoriteError')
          const returnTo = `${returnUrl.pathname}${returnUrl.search}`
          return modalWorkspace(
            workspace,
            favoriteModal(
              _,
              returnTo,
              localeQuery(url),
              url.searchParams.has('favoriteError') ? [_('product_backend.favorite.invalid')] : undefined,
            ),
          )
        },
      })
    },
  '/admin/product/templates/bulk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const denied = refusePost(req)
      if (denied) return denied
      const form = await readForm(req)
      const ids = Object.keys(form)
        .filter((key) => key.startsWith('selected.'))
        .map((key) => key.slice('selected.'.length))
        .filter(Boolean)
      const fallback = inLocale(url, '/admin/product/templates')
      const returnTo = form.returnTo?.startsWith('/admin/product/templates') ? form.returnTo : fallback
      if (!ids.length) return seeOther(returnTo)
      if (form.action === 'archive') {
        for (const id of ids) await ctx.call('product.archiveTemplate', { id, active: false }, url, req)
        return seeOther(returnTo)
      }
      if (form.action === 'delete') {
        try {
          await ctx.call('product.deleteTemplates', { ids }, url, req)
          return seeOther(returnTo)
        } catch {
          const failed = new URL(returnTo, 'http://ket.local')
          failed.searchParams.set('bulkError', 'delete')
          return seeOther(`${failed.pathname}${failed.search}`)
        }
      }
      return text('Unknown bulk action', { status: 400 })
    },
  '/admin/product/templates/favorites/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      // Refused before the body is read, not after.
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const form = req.method === 'POST' ? await readForm(req) : null
      const rawReturn = form?.returnTo ?? url.searchParams.get('returnTo') ?? '/admin/product/templates'
      const source = new URL(rawReturn, 'http://ket.local')
      const returnTo =
        source.pathname === '/admin/product/templates'
          ? `${source.pathname}${source.search}`
          : '/admin/product/templates'
      const modalHref = (invalid = false) => {
        const target = new URL(returnTo, 'http://ket.local')
        target.searchParams.set('modal', 'favorite')
        if (invalid) target.searchParams.set('favoriteError', '1')
        return `${target.pathname}${target.search}`
      }
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
        return seeOther(modalHref(true))
      }
      return seeOther(modalHref())
    },
  '/admin/product/templates/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const hasStock = await stockEnabled(ctx, req)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (hasStock && !validStockForm(form))
          return seeOther(inLocale(url, '/admin/product/templates/new?invalid=1&count=1'))
        const id = randomUUID()
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id,
            name: form.name ?? '',
            type: form.type || 'goods',
            // Sent as null rather than omitted: an absent key is skipped by the
            // changeset, so leaving it out would make the form's empty "—" option
            // a no-op and the field impossible to clear once set.
            uomId: form.uomId || null,
            categoryId: form.categoryId || null,
            brandId: form.brandId || null,
            origin: form.origin || null,
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
            ...(Object.hasOwn(form, 'defaultCode') ? { defaultCode: form.defaultCode || null } : {}),
            ...(Object.hasOwn(form, 'barcode') ? { barcode: form.barcode || null } : {}),
          },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok)
          return seeOther(
            inLocale(url, `/admin/product/templates/new?invalid=1&count=${errorsOf(result).length}`),
          )
        if (hasStock) {
          const stockResult = await configureStock(ctx, url, req, id, form)
          if (!(stockResult as { ok?: boolean }).ok)
            return seeOther(
              inLocale(url, `/admin/product/templates/${id}?invalid=1&count=${errorsOf(stockResult).length}`),
            )
        }
        return seeProduct(id, url)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const options = await optionsFor(ctx, url, req)
      const controls = {
        uom: await uomControl(ctx, url, req, _, { id: 'product-create-uom', units: options.uoms }),
        category: await categoryControl(ctx, url, req, _, {
          id: 'product-create-category',
          categories: options.categories,
        }),
      }
      return adminPage(ctx, url, req, {
        title: 'product_backend.create.title',
        body: (_, frame) =>
          newProductScreen(
            _,
            { ...options, stockEnabled: hasStock, errors: invalidErrors(url, _), controls },
            frame,
            localeQuery(url),
          ),
      })
    },
  '/admin/product/attributes':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const name = form.name?.trim()
        if (!name) return seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
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
          ? seeOther(inLocale(url, '/admin/product/attributes'))
          : seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('product.listAttributes', {}, url, req)) as Array<Record<string, unknown>>
      return adminPage(ctx, url, req, {
        title: 'product_backend.attributes.title',
        body: (_, frame) => attributesScreen(_, rows, frame, invalidErrors(url, _), localeQuery(url)),
      })
    },
  '/admin/product/attributes/{id}/values':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      const form = await readForm(req)
      const name = form.name?.trim()
      if (!name) return seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
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
        ? seeOther(inLocale(url, '/admin/product/attributes'))
        : seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
    },
  '/admin/product/templates/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const live = await ctx.live(req)
      const hasStock = await stockEnabled(ctx, req)
      const hasProductTax = Boolean(
        live.functions['account.getProductTax'] && live.functions['account.setProductTax'],
      )
      const activeTab = productTabOf(url)
      let savedPartial = false
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const partial = isProductPartial(req)
        const form = await readForm(req)
        if (hasStock && !validStockForm(form)) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: ['tracking'] },
              { status: 422 },
            )
          return seeOther(inLocale(url, `/admin/product/templates/${params.id}?invalid=1&count=1`))
        }
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id: params.id,
            name: form.name ?? '',
            type: form.type || 'goods',
            // Sent as null rather than omitted: an absent key is skipped by the
            // changeset, so leaving it out would make the form's empty "—" option
            // a no-op and the field impossible to clear once set.
            uomId: form.uomId || null,
            categoryId: form.categoryId || null,
            brandId: form.brandId || null,
            origin: form.origin || null,
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
            ...(Object.hasOwn(form, 'defaultCode') ? { defaultCode: form.defaultCode || null } : {}),
            ...(Object.hasOwn(form, 'barcode') ? { barcode: form.barcode || null } : {}),
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
            inLocale(url, `/admin/product/templates/${params.id}?invalid=1&count=${errorsOf(result).length}`),
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
              inLocale(
                url,
                `/admin/product/templates/${params.id}?invalid=1&count=${errorsOf(stockResult).length}`,
              ),
            )
          }
        }
        if (hasProductTax && Object.hasOwn(form, 'taxId')) {
          const taxResult = await ctx.call(
            'account.setProductTax',
            { templateId: params.id, taxId: form.taxId || null },
            url,
            req,
          )
          if (!(taxResult as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(taxResult),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(
                url,
                `/admin/product/templates/${params.id}?invalid=1&count=${errorsOf(taxResult).length}`,
              ),
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
        brandId?: string | null
        origin?: string | null
        saleOk?: boolean
        purchaseOk?: boolean
        active?: boolean
        variants?: Array<{
          id: string
          defaultCode?: string | null
          barcode?: string | null
          combinationKey?: string | null
          active?: boolean
        }>
        createdAt?: string | Date | null
        updatedAt?: string | Date | null
      } | null
      if (!row) return text('Product not found', { status: 404 })
      const [mediaRows, listedVariants, options, stockConfig, attributeLines, currentTax] = await Promise.all(
        [
          mediaFor(ctx, url, req, row.id),
          ctx.call('product.listVariants', { templateId: row.id }, url, req) as Promise<
            Array<{
              id: string
              name?: string | null
              defaultCode?: string | null
              barcode?: string | null
              combinationKey?: string | null
              active?: boolean
              values?: Array<{ value?: string | null; attribute?: string | null }>
            }>
          >,
          optionsFor(ctx, url, req),
          hasStock
            ? ctx.call('stock.getProductConfig', { templateId: row.id }, url, req)
            : Promise.resolve(null),
          ctx.call('product.listAttributeLines', { templateId: row.id }, url, req),
          hasProductTax
            ? ctx.call('account.getProductTax', { templateId: row.id }, url, req)
            : Promise.resolve(null),
        ],
      )
      const defaultVariant = (row.variants ?? []).find(
        (variant) => String(variant.combinationKey ?? '') === '',
      )
      const variants = listedVariants.filter((variant) => String(variant.combinationKey ?? '') !== '')
      const variantPageCount = Math.max(1, Math.ceil(variants.length / VARIANT_PAGE_SIZE))
      const variantPage = Math.min(requestedVariantPage(url), variantPageCount)
      const variantStart = (variantPage - 1) * VARIANT_PAGE_SIZE
      const visibleVariants = variants.slice(variantStart, variantStart + VARIANT_PAGE_SIZE)
      const stockByVariant = new Map<string, string>()
      if (activeTab === 'variants' && hasStock && live.functions['stock.forecast']) {
        const forecasts = await Promise.all(
          visibleVariants.map(async (variant) => ({
            id: variant.id,
            forecast: (await ctx.call('stock.forecast', { productId: variant.id }, url, req)) as {
              onHand?: string | number
            },
          })),
        )
        for (const entry of forecasts)
          stockByVariant.set(String(entry.id), String(entry.forecast.onHand ?? '0'))
      }
      const variantMediaPageCount = Math.max(1, Math.ceil(variants.length / MEDIA_VARIANT_PAGE_SIZE))
      const variantMediaPage = Math.min(requestedVariantMediaPage(url), variantMediaPageCount)
      const variantMediaStart = (variantMediaPage - 1) * MEDIA_VARIANT_PAGE_SIZE
      const visibleMediaVariants =
        activeTab === 'media'
          ? variants.slice(variantMediaStart, variantMediaStart + MEDIA_VARIANT_PAGE_SIZE)
          : variants
      const variantMediaRows =
        activeTab === 'media'
          ? ((await ctx.call(
              'product_media.listMediaByProducts',
              { productIds: visibleMediaVariants.map((variant) => variant.id) },
              url,
              req,
            )) as MediaRow[])
          : []
      const variantMedia = visibleMediaVariants.map((variant) => ({
        variantId: variant.id,
        images: variantMediaRows
          .filter((image) => image.productId === variant.id)
          .map((image) => ({
            id: image.id,
            src: `/files/${image.attachmentId}`,
            alt: image.alt || image.attachment?.name || variant.defaultCode || variant.name || variant.id,
            primary: image.primary,
            actions: {
              remove: inLocale(
                url,
                `/admin/product/templates/${row.id}/variants/${variant.id}/media/${image.id}/remove?tab=media`,
              ),
            },
          })),
      }))
      const body = productDetailScreen(
        _,
        {
          ...row,
          ...(stockConfig as Record<string, unknown> | null),
          defaultCode: defaultVariant?.defaultCode ?? null,
          barcode: defaultVariant?.barcode ?? null,
          taxId: (currentTax as { taxId?: string | null } | null)?.taxId ?? null,
        },
        {
          status: 'ready',
          uploadAction: inLocale(url, `/admin/product/templates/${row.id}/media?tab=media`),
          uploadControl: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:media.upload', {
                identity: `template:${row.id}`,
                action: inLocale(url, `/admin/product/templates/${row.id}/media?tab=media`),
                label: _('product_backend.media.add'),
              }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: `/files/${image.attachmentId}`,
            alt: image.alt || image.attachment?.name || row.name,
            primary: image.primary,
            actions: {
              primary: inLocale(
                url,
                `/admin/product/templates/${row.id}/media/${image.id}/primary?tab=media`,
              ),
              remove: inLocale(url, `/admin/product/templates/${row.id}/media/${image.id}/remove?tab=media`),
              ...(index > 0
                ? {
                    moveUp: inLocale(
                      url,
                      `/admin/product/templates/${row.id}/media/${image.id}/move-up?tab=media`,
                    ),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/product/templates/${row.id}/media/${image.id}/move-down?tab=media`,
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
          variants: (activeTab === 'media'
            ? visibleMediaVariants
            : activeTab === 'variants'
              ? visibleVariants
              : variants
          ).map((variant) => ({
            ...variant,
            ...(stockByVariant.has(String(variant.id))
              ? { stock: stockByVariant.get(String(variant.id)) }
              : {}),
          })),
          variantPage: {
            page: variantPage,
            pageSize: VARIANT_PAGE_SIZE,
            total: variants.length,
          },
          variantMedia,
          variantMediaPage: {
            page: variantMediaPage,
            pageSize: MEDIA_VARIANT_PAGE_SIZE,
            total: variants.length,
          },
          attributeLines: (
            attributeLines as Array<{
              id: string
              attributeId: string
              attribute?: string | null
              values: Array<{ id: string; name: string }>
            }>
          ).filter((line) =>
            options.variantAttributes.some((attribute) => attribute.value === line.attributeId),
          ),
          stockEnabled: hasStock,
          errors: invalidErrors(url, _),
          controls: {
            uom: await uomControl(ctx, url, req, _, {
              id: `product-uom:${row.id}`,
              value: row.uomId,
              units: options.uoms,
            }),
            category: await categoryControl(ctx, url, req, _, {
              id: `product-category:${row.id}`,
              value: row.categoryId,
              categories: options.categories,
            }),
            brand: await brandControl(ctx, url, req, _, {
              id: `product-brand:${row.id}`,
              value: row.brandId,
              brands: options.brands,
            }),
            attribute: await attributeControl(ctx, url, req, _, {
              id: `product-attribute:${row.id}`,
              attributes: options.variantAttributes,
              required: true,
            }),
            // The value picker cannot be scoped to an attribute yet — the two are
            // separate fields and the attribute is only known once chosen — so it
            // lists every value, each labelled with the attribute it belongs to.
            attributeValues: await attributeValuesControl(ctx, url, req, _, {
              id: `product-attribute-values:${row.id}`,
              choices: options.attributeValues,
              required: true,
            }),
          },
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
        savedPartial ? {} : await frameOf(ctx, url, req),
        localeQuery(url),
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
  '/admin/product/templates/{id}/variants/generate':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      const result = await ctx.call('product.generateVariants', { templateId: params.id }, url, req)
      return (result as { ok?: boolean }).ok
        ? seeProduct(params.id, url)
        : seeOther(inLocale(url, `/admin/product/templates/${params.id}?invalid=1`))
    },
  '/admin/product/templates/{id}/attribute-lines':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
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
        : seeOther(inLocale(url, `/admin/product/templates/${params.id}?invalid=1`))
    },
  '/admin/product/templates/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      const form = await readForm(req)
      await ctx.call('product.archiveTemplate', { id: params.id, active: form.active === '1' }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/attribute-lines/{lineId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      // The line has to belong to the template in the path, or a POST could take
      // an attribute off a product the reader never opened.
      const lines = (await ctx.call(
        'product.listAttributeLines',
        { templateId: params.id },
        url,
        req,
      )) as Array<{ id: string }>
      if (!lines.some((line) => line.id === params.lineId))
        return text('Attribute line not found', { status: 404 })
      await ctx.call('product.removeAttributeLine', { id: params.lineId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}':
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
        if (crossSite(req)) return text('Forbidden', { status: 403 })
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
            inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
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
            inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        {
          // The form's unit is a single select, so the submission replaces what
          // the variant has rather than adding to it — and an empty selection
          // clears it. Adding would leave the previous unit in place, and the
          // form would go on showing it.
          const productUom = await ctx.call(
            'product.setProductUom',
            {
              productId: params.variantId,
              uomId: form.uomId || null,
              barcode: form.uomBarcode || null,
            },
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
              inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
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
          uomId?: string | null
        } | null>,
        optionsFor(ctx, url, req),
        variantMediaFor(ctx, url, req, params.variantId),
      ])
      if (!current || current.templateId !== params.id || !template)
        return text('Variant not found', { status: 404 })
      // Both the picker and the plain select behind it are held to the template's
      // unit tree, so a unit that `setProductUom` would refuse is never offered.
      const unitRoot = unitRootOf(options.unitRows, template.uomId)
      const treeUnits = unitRoot
        ? options.uoms.filter((unit) => unitRootOf(options.unitRows, unit.value) === unitRoot)
        : options.uoms
      const variantUom = await uomControl(ctx, url, req, _, {
        id: `variant-uom:${params.variantId}`,
        value: Array.isArray(current.uoms)
          ? ((current.uoms[0] as Record<string, unknown> | undefined)?.uomId as string | undefined)
          : undefined,
        units: treeUnits,
        rootId: unitRoot,
      })
      const body = variantScreen(
        _,
        params.id,
        current,
        {
          status: 'ready',
          uploadAction: inLocale(
            url,
            `/admin/product/templates/${params.id}/variants/${params.variantId}/media?tab=media`,
          ),
          uploadControl: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:media.upload', {
                identity: `variant:${params.variantId}`,
                action: inLocale(
                  url,
                  `/admin/product/templates/${params.id}/variants/${params.variantId}/media?tab=media`,
                ),
                label: _('product_backend.media.add'),
              }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: `/files/${image.attachmentId}`,
            alt:
              image.alt ||
              image.attachment?.name ||
              String(current.name || current.defaultCode || current.id),
            primary: image.primary,
            actions: {
              primary: inLocale(
                url,
                `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/primary?tab=media`,
              ),
              remove: inLocale(
                url,
                `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/remove?tab=media`,
              ),
              ...(index > 0
                ? {
                    moveUp: inLocale(
                      url,
                      `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/move-up?tab=media`,
                    ),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/move-down?tab=media`,
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
        treeUnits,
        template,
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:variant.collaboration', {
              resModel: 'product.Product',
              resId: params.variantId,
              lang,
            }),
        savedPartial ? {} : await frameOf(ctx, url, req),
        invalidErrors(url, _),
        localeQuery(url),
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:variant.editor', {
              identity: `variant:${params.variantId}`,
              productId: params.variantId,
              lang,
            }),
        activeTab,
        savedPartial,
        variantUom,
      )
      if (savedPartial)
        return withHeaders(fragment(body, { type: NAVIGATION_TYPE }), { vary: 'X-Ket-Partial' })
      return backendPage(ctx, req, {
        lang,
        title: String(current.name || current.defaultCode || current.id),
        body,
      })
    },
  '/admin/product/templates/{id}/variants/{variantId}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req, 'POST multipart/form-data')
      if (denied) return denied
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
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, -1),
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, 1),
  '/admin/product/templates/{id}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req, 'POST multipart/form-data')
      if (denied) return denied
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
  '/admin/product/templates/{id}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, -1),
  '/admin/product/templates/{id}/media/{mediaId}/move-down':
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
  const denied = refusePost(req)
  if (denied) return denied
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
  const denied = refusePost(req)
  if (denied) return denied
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
