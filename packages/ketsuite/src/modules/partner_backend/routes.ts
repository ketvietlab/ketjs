import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, searchOf } from '../backend/paging.ts'
import { newPartnerScreen, partnerFormScreen, partnersScreen } from './screens/index.ts'
import { partnerRelationControl } from './relation-control.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { TableSelection } from '../../ui/index.ts'
import { tableGrid } from '../backend/ket-table.ts'
import type { KetTableColumn, KetTableGroup } from '../backend/ket-table.ts'
import { searchFilterBar } from '../backend/search-filter.ts'
import type { SearchFacet, SearchFilterConfig } from '../backend/search-filter.ts'

/** The only two fields the partner list can currently be grouped by. */
type PartnerGroupBy = 'kind' | 'state'
const isPartnerGroupBy = (value: string | null): value is PartnerGroupBy =>
  value === 'kind' || value === 'state'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const onlyPost = (req: Req) =>
  req.method !== 'POST'
    ? text('POST', { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

// Seeds the parent-organisation relation-select with only the currently chosen
// company (if any) — the widget already searches `partner.listPartners` for the
// rest as the user types, so preloading every company here would mean fetching
// (and embedding into the page as JSON) the entire company partner list on every
// partner detail render, which does not scale past a few thousand partners.
const partnerOptions = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  parentId?: string | null,
  exclude?: string,
) => {
  if (!parentId || parentId === exclude) return []
  const rows = (await ctx.call(
    'partner.listPartners',
    { ids: [parentId], kind: 'company', includeArchived: true },
    url,
    req,
  )) as AnyRow[]
  return rows
    .filter((row) => row.id !== exclude)
    .map((row) => ({ value: String(row.id), label: String(row.name) }))
}

const parentControlFor = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: ReturnType<ServeContext['translate']>,
  parents: Array<{ value: string; label: string }>,
  options: { id: string; value?: string | null; excludeIds?: string[] },
) =>
  partnerRelationControl(ctx, url, req, _, {
    id: options.id,
    name: 'parentId',
    value: options.value,
    partners: parents.map((parent) => ({ id: parent.value, name: parent.label })),
    fieldLabel: _('partner_backend.field.parent'),
    title: _('partner_backend.relation.parents'),
    allowEmpty: true,
    excludeIds: options.excludeIds,
    companiesOnly: true,
  })

const translatedErrors = (result: unknown, _: ReturnType<ServeContext['translate']>): string[] =>
  ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'partner.error.invalid')}`,
  )

const addressFormsFor = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  partnerId: string,
  addresses: AnyRow[],
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const installed = (await ctx.call('address.listCountries', {}, url, req)) as AnyRow[]
  const available = (await ctx.call('address.availableCatalogs', {}, url, req)) as AnyRow[]
  // Seed/demo records may bypass the address module's catalog validation. Never
  // serialize those synthetic ids into every address island: besides presenting
  // invalid choices, a large data-key can turn a small form into megabytes of
  // hydration markup. Country codes accepted by the address domain are ISO 3166-1
  // alpha-2 uppercase codes, so enforce the same boundary when composing the UI.
  const countryCodeOf = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toUpperCase()
  const isCountryCode = (value: string) => /^[A-Z]{2}$/.test(value)
  const countryCodes = new Set(
    [
      ...installed.map((row) => countryCodeOf(row.code)),
      ...available.map((row) => countryCodeOf(row.countryCode)),
    ].filter(isCountryCode),
  )
  countryCodes.add('VN')
  const countries = [...countryCodes].sort().map((value) => ({
    value,
    label:
      installed.find((row) => countryCodeOf(row.code) === value)?.localName ||
      installed.find((row) => countryCodeOf(row.code) === value)?.name ||
      (value === 'VN' ? _('partner_backend.address.country.VN') : value),
  }))
  const roots = new Map<string, AnyRow[]>()
  const children = new Map<string, AnyRow[]>()
  const list = async (countryCode: string, parentId?: string | null) => {
    const cache = parentId ? children : roots
    const key = parentId ? `${countryCode}:${parentId}` : countryCode
    const held = cache.get(key)
    if (held) return held
    const rows = (await ctx.call(
      'address.listDivisionChildren',
      { countryCode, parentId: parentId || null, limit: 1000 },
      url,
      req,
    )) as AnyRow[]
    cache.set(key, rows)
    return rows
  }
  const uses = ['contact', 'invoice', 'delivery', 'other'].map((value) => ({
    value,
    label: _(`partner.use.${value}`),
  }))
  const labels = {
    use: _('partner_backend.address.use'),
    street: _('partner_backend.address.street'),
    street2: _('partner_backend.address.street2'),
    locality: _('partner_backend.address.locality'),
    localityHint: _('partner_backend.address.localityHint'),
    postalCode: _('partner_backend.address.zip'),
    country: _('partner_backend.address.country'),
    province: _('partner_backend.address.province'),
    division: _('partner_backend.address.division'),
    chooseProvince: _('partner_backend.address.chooseProvince'),
    chooseDivision: _('partner_backend.address.chooseDivision'),
    loading: _('partner_backend.address.loading'),
    loadError: _('partner_backend.address.loadError'),
    catalogMissing: _('partner_backend.address.catalogMissing'),
    default: _('partner_backend.address.default'),
    previewHint: _('partner_backend.address.previewHint'),
  }
  const render = async (address: AnyRow, isNew = false) => {
    const countryCode = String(address.countryCode || 'VN')
    let provinceId: string | null = null
    if (address.divisionId) {
      const path = (await ctx.call(
        'address.resolveDivisionPath',
        { id: address.divisionId },
        url,
        req,
      )) as AnyRow[]
      provinceId = path.find((entry) => Number(entry.level) === 1)?.id
        ? String(path.find((entry) => Number(entry.level) === 1)!.id)
        : null
    }
    const body = await ctx.joint(url, req, 'partner_backend:address.form', {
      action: isNew
        ? inLocale(url, `/admin/partner/partners/${partnerId}/addresses`)
        : inLocale(url, `/admin/partner/partners/${partnerId}/addresses/${address.id}`),
      address,
      countries,
      provinces: await list(countryCode),
      provinceId,
      divisions: provinceId ? await list(countryCode, provinceId) : [],
      uses,
      labels,
      submitLabel: isNew ? _('partner_backend.action.addAddress') : _('partner_backend.action.saveAddress'),
      defaultCountry: 'VN',
    })
    return {
      title: isNew
        ? _('partner_backend.address.new')
        : `${_(`partner.use.${address.use}`)}${address.isDefault ? ` · ${_('partner_backend.address.default')}` : ''}`,
      body,
    }
  }
  return Promise.all([
    ...addresses.map((address) => render(address)),
    render({ use: 'contact', countryCode: 'VN', isDefault: false }, true),
  ])
}

export const renderPartnerForm = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  errors?: string[],
  overlay?: import('@ketvietlab/ketjs-view').JSXChild,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const row = (await ctx.call('partner.getPartner', { id }, url, req)) as AnyRow | null
  if (!row) return text(_('partner_backend.error.notFound'), { status: 404 })
  const [parents, terms, integration, salesActions, collaboration] = await Promise.all([
    partnerOptions(ctx, url, req, row.parentId ? String(row.parentId) : null, id),
    ctx.call('partner.getTerms', { partnerId: id }, url, req) as Promise<AnyRow | null>,
    ctx.joint(url, req, 'partner_backend:record.actions', {
      partnerId: id,
      locale: url.searchParams.get('lang')
        ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
        : '',
    }),
    ctx.joint(url, req, 'partner_backend:record.salesActions', {
      partnerId: id,
      lang,
    }),
    ctx.joint(url, req, 'partner_backend:record.collaboration', {
      resModel: 'partner.Partner',
      resId: id,
      lang,
    }),
  ])
  const parentControl = await parentControlFor(ctx, url, req, _, parents, {
    id: `partner-parent-${id}`,
    value: row.parentId ? String(row.parentId) : '',
    excludeIds: [id],
  })
  const addressForms = await addressFormsFor(
    ctx,
    url,
    req,
    id,
    Array.isArray(row.addresses) ? (row.addresses as AnyRow[]) : [],
  )
  return adminPage(ctx, url, req, {
    title: String(row.name),
    translate: false,
    body: (_, frame) =>
      partnerFormScreen(
        _,
        row as never,
        {
          parents,
          terms: terms as never,
          errors,
          integration,
          salesActions,
          collaboration,
          addressForms,
          parentControl,
          overlay,
        },
        frame,
        url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
      ),
  })
}

const syncPartnerRoles = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  partnerId: string,
  form: Record<string, string>,
) => {
  for (const role of ['customer', 'supplier', 'employee']) {
    const result =
      form[role] === '1'
        ? await ctx.call('partner.grantRole', { id: randomUUID(), partnerId, role }, url, req)
        : await ctx.call('partner.revokeRole', { partnerId, role }, url, req)
    if ((result as { ok?: boolean }).ok === false) return result
  }
  return { ok: true }
}

const savePartner = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  form: Record<string, string>,
) => {
  const result = await ctx.call(
    'partner.savePartner',
    {
      id,
      kind: form.kind || 'company',
      name: form.name ?? '',
      parentId: form.parentId || null,
      vat: form.vat || null,
      ref: form.ref || null,
      email: form.email || null,
      phone: form.phone || null,
      lang: form.lang || null,
    },
    url,
    req,
  )
  if ((result as { ok?: boolean }).ok === false) return result
  const roles = await syncPartnerRoles(ctx, url, req, id, form)
  return (roles as { ok?: boolean }).ok === false ? roles : result
}

export const routes: Record<string, RouteEntry> = {
  '/admin/partner/partners':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const current = pageOf(url)
      const search = searchOf(url)
      const role = url.searchParams.get('role') || undefined
      const includeArchived = url.searchParams.get('archived') === '1'
      const groupBy = isPartnerGroupBy(url.searchParams.get('groupBy'))
        ? url.searchParams.get('groupBy')
        : undefined
      const filter = { search, role, includeArchived }

      let rows: AnyRow[] = []
      let total = 0
      let groups: KetTableGroup[] | undefined
      if (groupBy === 'kind') {
        const [companyCount, personCount, companyRows, personRows] = await Promise.all([
          ctx.call('partner.countPartners', { ...filter, kind: 'company' }, url, req) as Promise<{
            count: number
          }>,
          ctx.call('partner.countPartners', { ...filter, kind: 'person' }, url, req) as Promise<{
            count: number
          }>,
          ctx.call(
            'partner.listPartners',
            { ...filter, groupBy: ['kind'], groupPath: ['company'], limit: PAGE_SIZE },
            url,
            req,
          ) as Promise<AnyRow[]>,
          ctx.call(
            'partner.listPartners',
            { ...filter, groupBy: ['kind'], groupPath: ['person'], limit: PAGE_SIZE },
            url,
            req,
          ) as Promise<AnyRow[]>,
        ])
        groups = [
          { id: 'company', label: _('partner.kind.company'), count: companyCount.count, rows: companyRows },
          { id: 'person', label: _('partner.kind.person'), count: personCount.count, rows: personRows },
        ]
        total = companyCount.count + personCount.count
      } else if (groupBy === 'state') {
        // Grouping by state shows both buckets regardless of the `archived`
        // filter facet — that checkbox has nothing left to add once the group
        // headers already separate active from archived.
        const stateFilter = { search, role }
        const [activeCount, inclusiveCount, activeRows, archivedRows] = await Promise.all([
          ctx.call('partner.countPartners', { ...stateFilter, includeArchived: false }, url, req) as Promise<{
            count: number
          }>,
          ctx.call('partner.countPartners', { ...stateFilter, includeArchived: true }, url, req) as Promise<{
            count: number
          }>,
          ctx.call(
            'partner.listPartners',
            { ...stateFilter, groupBy: ['state'], groupPath: ['active'], limit: PAGE_SIZE },
            url,
            req,
          ) as Promise<AnyRow[]>,
          ctx.call(
            'partner.listPartners',
            { ...stateFilter, groupBy: ['state'], groupPath: ['archived'], limit: PAGE_SIZE },
            url,
            req,
          ) as Promise<AnyRow[]>,
        ])
        const archivedCount = Math.max(0, inclusiveCount.count - activeCount.count)
        groups = [
          {
            id: 'active',
            label: _('partner_backend.state.active'),
            count: activeCount.count,
            rows: activeRows,
          },
          {
            id: 'archived',
            label: _('partner_backend.state.archived'),
            count: archivedCount,
            rows: archivedRows,
          },
        ]
        total = inclusiveCount.count
      } else {
        const [listRows, countResult] = await Promise.all([
          ctx.call(
            'partner.listPartners',
            { ...filter, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
            url,
            req,
          ) as Promise<AnyRow[]>,
          ctx.call('partner.countPartners', filter, url, req) as Promise<{ count: number }>,
        ])
        rows = listRows
        total = countResult.count
      }

      const selection: TableSelection = {
        formId: 'partner-directory-bulk',
        action: inLocale(url, '/admin/partner/partners/bulk'),
        hidden: { returnTo: `${url.pathname}${url.search}` },
        actions: [
          { id: 'archive', label: _('partner_backend.action.bulkArchive') },
          ...(includeArchived ? [{ id: 'restore', label: _('partner_backend.action.bulkRestore') }] : []),
        ],
      }
      const langSuffix = url.searchParams.get('lang')
        ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
        : ''

      const facets: SearchFacet[] = [
        ...(search ? [{ id: 'search:current', type: 'field' as const, label: search }] : []),
        ...(role === 'customer'
          ? [{ id: 'customer', type: 'filter' as const, label: _('partner_backend.filter.customers') }]
          : []),
        ...(role === 'supplier'
          ? [{ id: 'supplier', type: 'filter' as const, label: _('partner_backend.filter.suppliers') }]
          : []),
        ...(includeArchived
          ? [{ id: 'archived', type: 'filter' as const, label: _('partner_backend.filter.includeArchived') }]
          : []),
        ...(groupBy
          ? [{ id: groupBy, type: 'groupBy' as const, label: _(`partner_backend.groupBy.${groupBy}`) }]
          : []),
      ]
      const searchFilterConfig: SearchFilterConfig = {
        name: 'partner-directory-filter',
        facets,
        filters: [
          {
            id: 'customer',
            label: _('partner_backend.filter.customers'),
            active: role === 'customer',
            group: 'role',
          },
          {
            id: 'supplier',
            label: _('partner_backend.filter.suppliers'),
            active: role === 'supplier',
            group: 'role',
          },
          {
            id: 'archived',
            label: _('partner_backend.filter.includeArchived'),
            active: includeArchived,
            group: 'state',
          },
        ],
        groupBy: [
          { id: 'kind', label: _('partner_backend.groupBy.kind'), active: groupBy === 'kind' },
          { id: 'state', label: _('partner_backend.groupBy.state'), active: groupBy === 'state' },
        ],
        favorites: [],
        customFilterFields: [],
        labels: {
          searchLabel: _('partner_backend.search.label'),
          searchPlaceholder: _('partner_backend.search.placeholder'),
          toggleLabel: _('partner_backend.search.toggle'),
          filters: _('partner_backend.search.filters'),
          groupBy: _('partner_backend.search.groupBy'),
          favorites: _('partner_backend.search.favorites'),
          searchGenericLabel: _('partner_backend.search.genericLabel'),
          searchFieldPrefix: _('partner_backend.search.fieldPrefix'),
          searchFieldPreposition: _('partner_backend.search.fieldPreposition'),
          customFilterField: _('partner_backend.search.customFilterField'),
          customFilterOperator: _('partner_backend.search.customFilterOperator'),
          customFilterValue: _('partner_backend.search.customFilterValue'),
          customFilterAdd: _('partner_backend.search.customFilterAdd'),
          customGroupByPlaceholder: _('partner_backend.search.customGroupByPlaceholder'),
          saveSearch: _('partner_backend.search.saveSearch'),
          favoriteName: _('partner_backend.search.favoriteName'),
          favoriteDefault: _('partner_backend.search.favoriteDefault'),
          favoriteSaveAction: _('partner_backend.search.favoriteSaveAction'),
          favoriteRemove: _('partner_backend.search.favoriteRemove'),
          favoriteSetDefault: _('partner_backend.search.favoriteSetDefault'),
          noFavorites: _('partner_backend.search.noFavorites'),
          clear: _('partner_backend.search.clear'),
          applyError: _('partner_backend.search.applyError'),
          retry: _('partner_backend.search.retry'),
        },
        manager: { applyFunction: 'partner_backend.applyFilter', bodyId: 'partner-directory-table' },
      }

      return adminPage(ctx, url, req, {
        title: 'partner_backend.screen.title',
        body: async (_, frame) => {
          const filterBar = await searchFilterBar(
            ctx,
            url,
            req,
            'partner-directory-filter',
            searchFilterConfig,
          )
          const columns: KetTableColumn[] = [
            {
              key: 'name',
              label: _('partner_backend.field.name'),
              format: { kind: 'person', field: 'name' },
              priority: 'primary',
              width: 'wide',
              sortable: true,
            },
            {
              key: 'kind',
              label: _('partner_backend.field.kind'),
              format: {
                kind: 'status',
                field: 'kind',
                tones: {
                  company: { label: _('partner.kind.company'), tone: 'info' },
                  person: { label: _('partner.kind.person'), tone: 'neutral' },
                },
              },
              sortable: true,
            },
            {
              key: 'email',
              label: _('partner_backend.field.email'),
              format: { kind: 'text', field: 'email' },
              sortable: true,
            },
            {
              key: 'phone',
              label: _('partner_backend.field.phone'),
              format: { kind: 'text', field: 'phone' },
              sortable: true,
            },
            {
              key: 'ref',
              label: _('partner_backend.field.ref'),
              format: { kind: 'identifier', field: 'ref' },
              sortable: true,
            },
            {
              key: 'state',
              label: _('partner_backend.field.state'),
              format: {
                kind: 'status',
                field: 'active',
                tones: {
                  true: { label: _('partner_backend.state.active'), tone: 'positive' },
                  false: { label: _('partner_backend.state.archived'), tone: 'neutral' },
                },
              },
            },
          ]
          const grid = await tableGrid(ctx, url, req, 'partner-directory-table', {
            columns,
            rows: rows as never,
            total,
            idField: 'id',
            rowHrefTemplate: `/admin/partner/partners/{id}${langSuffix}`,
            groupBy: groupBy ? [groupBy] : undefined,
            groups: groups as never,
            selection: { formId: 'partner-directory-bulk' },
            manager: {
              listFunction: 'partner.listPartners',
              // No `groupFunction`: with a single group-by level, an expanded
              // group's `depth` always equals `groupBy.length`, so `KetTable`
              // only ever calls `listFunction` (for that group's rows) — see
              // `fetchGroupLevel` in `ket-table/index.tsx`. It would only be
              // reached by a second grouping level, which this screen doesn't offer.
              listInput: { search, role, includeArchived },
              pageSize: PAGE_SIZE,
            },
            labels: {
              selectAll: _('partner_backend.table.selectAll'),
              selectRow: _('partner_backend.table.selectRow'),
              sortedAscending: _('partner_backend.table.sortAscending'),
              sortedDescending: _('partner_backend.table.sortDescending'),
              previousPage: _('partner_backend.table.previousPage'),
              nextPage: _('partner_backend.table.nextPage'),
              loading: _('partner_backend.table.loading'),
              loadError: _('partner_backend.table.loadError'),
              retry: _('partner_backend.table.retry'),
              empty: _('partner_backend.screen.empty'),
              emptyHint: _('partner_backend.screen.emptyHint'),
            },
          })
          return partnersScreen(
            _,
            {
              ...frame,
              chrome: {
                create: {
                  label: _('partner_backend.action.create'),
                  path: inLocale(url, '/admin/partner/partners/new'),
                },
                selection,
              },
            },
            filterBar,
            grid,
            total,
          )
        },
      })
    },

  '/admin/partner/partners/bulk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const denied = onlyPost(req)
      if (denied) return denied
      const form = await readForm(req)
      const ids = Object.keys(form)
        .filter((key) => key.startsWith('selected.'))
        .map((key) => key.slice('selected.'.length))
        .filter(Boolean)
      const fallback = inLocale(url, '/admin/partner/partners')
      const requested = new URL(form.returnTo || fallback, 'http://ket.local')
      const returnTo =
        requested.pathname === '/admin/partner/partners'
          ? `${requested.pathname}${requested.search}`
          : fallback
      if (!ids.length) return seeOther(returnTo)
      if (form.action !== 'archive' && form.action !== 'restore')
        return text('Unknown bulk action', { status: 400 })
      const result = (await ctx.call(
        'partner.archivePartners',
        { ids, active: form.action === 'restore' },
        url,
        req,
      )) as { ok?: boolean }
      if (result.ok === false) return text('Invalid bulk selection', { status: 400 })
      return seeOther(returnTo)
    },

  '/admin/partner/partners/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await savePartner(ctx, url, req, id, form)
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/partner/partners/${id}`))
        const parents = await partnerOptions(ctx, url, req, form.parentId || null)
        return adminPage(ctx, url, req, {
          title: 'partner_backend.create.title',
          body: async (_, frame) =>
            newPartnerScreen(
              _,
              parents,
              frame,
              translatedErrors(result, _),
              url.searchParams.get('lang')
                ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
                : '',
              await parentControlFor(ctx, url, req, _, parents, {
                id: 'partner-parent-new',
                value: form.parentId,
              }),
            ),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const parents = await partnerOptions(ctx, url, req, null)
      return adminPage(ctx, url, req, {
        title: 'partner_backend.create.title',
        body: async (_, frame) =>
          newPartnerScreen(
            _,
            parents,
            frame,
            undefined,
            url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
            await parentControlFor(ctx, url, req, _, parents, { id: 'partner-parent-new' }),
          ),
      })
    },

  '/admin/partner/partners/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderPartnerForm(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const result = await savePartner(ctx, url, req, params.id, await readForm(req))
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
      return renderPartnerForm(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
    },

  '/admin/partner/partners/{id}/edit':
    (_ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
    },

  '/admin/partner/partners/{id}/roles':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      await syncPartnerRoles(ctx, url, req, params.id, form)
      return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
    },

  '/admin/partner/partners/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      await ctx.call('partner.archivePartner', { id: params.id, active: form.action === 'restore' }, url, req)
      return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
    },

  '/admin/partner/partners/{id}/addresses':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveAddress',
        {
          id: randomUUID(),
          partnerId: params.id,
          use: form.use || 'contact',
          street1: form.street1 ?? '',
          street2: form.street2 || null,
          locality: form.locality || null,
          postalCode: form.postalCode || null,
          countryId: form.countryId || 'VN',
          divisionId: form.divisionId || null,
          isDefault: form.isDefault === '1',
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
        : renderPartnerForm(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },

  '/admin/partner/partners/{id}/addresses/{addressId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveAddress',
        {
          id: params.addressId,
          partnerId: params.id,
          use: form.use || 'contact',
          street1: form.street1 ?? '',
          street2: form.street2 || null,
          locality: form.locality || null,
          postalCode: form.postalCode || null,
          countryId: form.countryId || 'VN',
          divisionId: form.divisionId || null,
          isDefault: form.isDefault === '1',
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
        : renderPartnerForm(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },

  '/admin/partner/partners/{id}/terms':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveTerms',
        {
          id: randomUUID(),
          partnerId: params.id,
          creditLimit: form.creditLimit || null,
          note: form.note || null,
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
        : renderPartnerForm(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },
}
