import { randomUUID } from 'node:crypto'
import { json, projectBrowserRows, projectBrowserScreen, text } from '@ketvietlab/ketjs'
import type { BrowserScreenPlan, Route, RouteEntry, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { newPartnerScreen, partnerFormScreen, partnersScreen } from './screens/index.ts'
import { partnerRelationControl } from './relation-control.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { Frame, TableSelection } from '../../ui/index.ts'
import { browserResourceMap, browserTable, browserTableBootstrap } from '../../ui/index.ts'
import type { PartnerListSummary } from './screens/types.ts'

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

const partnerOptions = async (ctx: ServeContext, url: URL, req: Req, exclude?: string) =>
  (
    (await ctx.call(
      'partner.listPartners',
      { kind: 'company', includeArchived: false },
      url,
      req,
    )) as AnyRow[]
  )
    .filter((row) => row.id !== exclude)
    .map((row) => ({ value: String(row.id), label: String(row.name) }))

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
  const [row, parents, terms, integration, salesActions, collaboration] = await Promise.all([
    ctx.call('partner.getPartner', { id }, url, req) as Promise<AnyRow | null>,
    partnerOptions(ctx, url, req, id),
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
  if (!row) return text(_('partner_backend.error.notFound'), { status: 404 })
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

type PartnerDirectoryData = {
  rows: AnyRow[]
  total: number
  activeTotal: number
  inclusiveTotal: number
  customerTotal: number
  supplierTotal: number
}

type PartnerDirectorySummaryData = {
  total: number
  active: number
  inclusive: number
  customers: number
  suppliers: number
}

const optimizedDirectorySummary = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<PartnerDirectorySummaryData> =>
  ctx.call(
    'partner.directorySummary',
    {
      search: searchOf(url),
      role: url.searchParams.get('role') || undefined,
      includeArchived: url.searchParams.get('archived') === '1',
    },
    url,
    req,
  ) as Promise<PartnerDirectorySummaryData>

const optimizedDirectoryData = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<PartnerDirectoryData> => {
  const current = pageOf(url)
  const search = searchOf(url)
  const role = url.searchParams.get('role') || undefined
  const includeArchived = url.searchParams.get('archived') === '1'
  const [rows, summary] = await Promise.all([
    ctx.call(
      'partner.listPartners',
      { search, role, includeArchived, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
      url,
      req,
    ) as Promise<AnyRow[]>,
    optimizedDirectorySummary(ctx, url, req),
  ])
  return {
    rows,
    total: summary.total,
    activeTotal: summary.active,
    inclusiveTotal: summary.inclusive,
    customerTotal: summary.customers,
    supplierTotal: summary.suppliers,
  }
}

const directorySelection = (url: URL, _: Translator, includeArchived: boolean): TableSelection => ({
  formId: 'partner-directory-bulk',
  action: inLocale(url, '/admin/partner/partners/bulk'),
  hidden: { returnTo: `${url.pathname}${url.search}` },
  actions: [
    { id: 'archive', label: _('partner_backend.action.bulkArchive') },
    ...(includeArchived ? [{ id: 'restore', label: _('partner_backend.action.bulkRestore') }] : []),
  ],
})

const directoryFrame = (
  url: URL,
  _: Translator,
  frame: Frame,
  selection: TableSelection,
  rowCount: number,
  total: number,
): Frame => {
  const current = pageOf(url)
  const search = searchOf(url)
  const role = url.searchParams.get('role') || undefined
  const includeArchived = url.searchParams.get('archived') === '1'
  const prototype = url.searchParams.get('prototype')
  return {
    ...frame,
    chrome: {
      create: {
        label: _('partner_backend.action.create'),
        path: inLocale(url, '/admin/partner/partners/new'),
      },
      selection,
      search: {
        name: 'q',
        value: search ?? '',
        placeholder: _('partner_backend.chrome.search'),
        keep: {
          ...(role ? { role } : {}),
          ...(includeArchived ? { archived: '1' } : {}),
          ...(prototype ? { prototype } : {}),
          ...(url.searchParams.get('lang') ? { lang: url.searchParams.get('lang')! } : {}),
        },
        facets: role ? [{ label: _(`partner.role.${role}`), without: withParam(url, 'role', null) }] : [],
        menus: [
          {
            id: 'filters',
            label: _('backend.chrome.filters'),
            items: [
              {
                id: 'customers',
                label: _('partner_backend.filter.customers'),
                path: withParam(url, 'role', role === 'customer' ? null : 'customer'),
                active: role === 'customer',
              },
              {
                id: 'suppliers',
                label: _('partner_backend.filter.suppliers'),
                path: withParam(url, 'role', role === 'supplier' ? null : 'supplier'),
                active: role === 'supplier',
              },
              {
                id: 'archived',
                label: _('partner_backend.filter.includeArchived'),
                path: withParam(url, 'archived', includeArchived ? null : '1'),
                active: includeArchived,
              },
            ],
          },
        ],
      },
      pager: pager(url, current, rowCount, total),
    },
  }
}

const directorySummary = (url: URL, data: PartnerDirectoryData): PartnerListSummary => {
  const role = url.searchParams.get('role') || undefined
  const includeArchived = url.searchParams.get('archived') === '1'
  const listHref = (changes: Record<string, string | null>) => {
    const target = new URL(url)
    target.searchParams.delete('page')
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) target.searchParams.delete(key)
      else target.searchParams.set(key, value)
    }
    return `${target.pathname}${target.search}`
  }
  return {
    total: data.activeTotal,
    customers: data.customerTotal,
    suppliers: data.supplierTotal,
    archived: Math.max(0, data.inclusiveTotal - data.activeTotal),
    allHref: listHref({ role: null, archived: null }),
    customersHref: listHref({ role: 'customer', archived: null }),
    suppliersHref: listHref({ role: 'supplier', archived: null }),
    archivedHref: listHref({ role: null, archived: '1' }),
    active: includeArchived
      ? 'archived'
      : role === 'customer'
        ? 'customers'
        : role === 'supplier'
          ? 'suppliers'
          : 'all',
  }
}

const planResources = async (
  ctx: ServeContext,
  plan: BrowserScreenPlan,
  rows: Row[],
  phases: ReadonlySet<string>,
  url: URL,
  req: Req,
): Promise<{ rows: Record<string, Row[]>; errors: Record<string, string> }> => {
  const selected = Object.values(plan.resources).filter(
    (resource) => resource.id !== plan.screen.primary && phases.has(resource.phase),
  )
  const ids = [...new Set(rows.map((row) => String(row[plan.screen.rowKey])))]
  const output: Record<string, Row[]> = {}
  const errors: Record<string, string> = {}
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      const resource = selected[next++]!
      try {
        const batches: string[][] = []
        const size = resource.batch?.max ?? (ids.length || 1)
        for (let at = 0; at < ids.length; at += size) batches.push(ids.slice(at, at + size))
        const values = await Promise.all(
          batches.map(async (batch) => {
            const value = await ctx.call(
              resource.source,
              resource.batch ? { [resource.batch.input]: batch } : {},
              url,
              req,
            )
            return value
          }),
        )
        output[resource.id] = projectBrowserRows(resource, values.flat())
      } catch (error) {
        errors[resource.id] = error instanceof Error ? error.message : String(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, () => worker()))
  return { rows: output, errors }
}

const partnerBrowserPlan = async (ctx: ServeContext, url: URL, req: Req, _: Translator) => {
  const manifest = await ctx.live(req)
  return projectBrowserScreen(manifest, 'partner_backend.partners', {
    allows: (name) => ctx.allows(name, url, req),
    translate: (key) => _(key),
  })
}

const browserPrototype = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  mode: 'ssr-matched' | 'csr-two-stage' | 'csr-planned',
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const plan = await partnerBrowserPlan(ctx, url, req, _)
  if (!plan) return text(_('backend.error.forbidden.title'), { status: 403 })

  const rawBase = mode === 'csr-two-stage' ? null : await optimizedDirectoryData(ctx, url, req)
  const base = rawBase
    ? {
        ...rawBase,
        rows: projectBrowserRows(plan.resources[plan.screen.primary]!, rawBase.rows),
      }
    : null
  const summaryOnly = base ? null : await optimizedDirectorySummary(ctx, url, req)
  const directory: PartnerDirectoryData = base ?? {
    rows: [],
    total: summaryOnly!.total,
    activeTotal: summaryOnly!.active,
    inclusiveTotal: summaryOnly!.inclusive,
    customerTotal: summaryOnly!.customers,
    supplierTotal: summaryOnly!.suppliers,
  }
  const loaded = base
    ? await planResources(
        ctx,
        plan,
        base.rows,
        mode === 'ssr-matched' ? new Set(['essential', 'deferred']) : new Set(['essential']),
        url,
        req,
      )
    : { rows: {}, errors: {} }
  const state = {
    rows: (base?.rows ?? []) as Row[],
    resources: Object.fromEntries(
      Object.entries(loaded.rows).map(([id, resourceRows]) => [
        id,
        browserResourceMap(resourceRows, plan.resources[id]!.key),
      ]),
    ),
    loading: [],
    errors: loaded.errors,
    total: directory.total,
    requiredReady:
      base !== null &&
      Object.values(plan.resources)
        .filter(({ phase }) => phase === 'essential')
        .every(({ id }) => Object.hasOwn(loaded.rows, id)),
    phase: mode === 'ssr-matched' ? ('complete' as const) : base ? ('primary' as const) : ('shell' as const),
  }
  const includeArchived = url.searchParams.get('archived') === '1'
  const selection = directorySelection(url, _, includeArchived)
  const locale = url.searchParams.get('lang')
    ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
    : ''
  const rowBase = '/admin/partner/partners'
  const rowQuery = locale || undefined
  const rowHref = (row: Row) =>
    `${rowBase}/${encodeURIComponent(String(row[plan.screen.rowKey]))}${rowQuery ?? ''}`
  const rowCount = base
    ? state.rows.length
    : Math.min(PAGE_SIZE, Math.max(0, directory.total - (pageOf(url) - 1) * PAGE_SIZE))
  const tableOptions = {
    emptyTitle: _('partner_backend.screen.empty'),
    emptyMessage: _('partner_backend.screen.emptyHint'),
    loadingLabel: _('partner_backend.screen.loading'),
    locale: lang,
    rowHref,
    responsive: 'stack' as const,
    selection,
    selectAllLabel: _('backend.table.selectAll'),
    selectRowLabel: _('backend.table.selectRow'),
  }
  if (mode === 'ssr-matched') {
    return adminPage(ctx, url, req, {
      title: plan.screen.title,
      translate: false,
      body: (_, frame) =>
        partnersScreen(
          _,
          state.rows as never,
          directoryFrame(url, _, frame, selection, rowCount, directory.total),
          { selection },
          locale,
          directorySummary(url, directory),
          directory.total,
          browserTable(plan, state, {}, tableOptions),
        ),
    })
  }

  const dataUrl = new URL(url)
  dataUrl.pathname = '/admin/partner/partners/browser-data'
  dataUrl.searchParams.delete('prototype')
  const scope = await ctx.scopeOf(url, req)
  const bootstrap = {
    mode,
    plan,
    baseEndpoint: `${dataUrl.pathname}${dataUrl.search}`,
    contextKey: JSON.stringify({ revision: plan.revision, scope, query: dataUrl.search }),
    concurrency: 4,
    initial: {
      rows: state.rows,
      total: state.total,
      resources: loaded.rows,
      errors: loaded.errors,
    },
    emptyTitle: _('partner_backend.screen.empty'),
    emptyMessage: _('partner_backend.screen.emptyHint'),
    loadingLabel: _('partner_backend.screen.loading'),
    locale: lang,
    rowBase,
    rowQuery,
    selection,
    selectAllLabel: _('backend.table.selectAll'),
    selectRowLabel: _('backend.table.selectRow'),
  }
  return adminPage(ctx, url, req, {
    title: plan.screen.title,
    translate: false,
    body: (_, frame) =>
      partnersScreen(
        _,
        state.rows as never,
        directoryFrame(url, _, frame, selection, rowCount, directory.total),
        { selection },
        locale,
        directorySummary(url, directory),
        directory.total,
        browserTableBootstrap(bootstrap, browserTable(plan, state, {}, tableOptions)),
      ),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/partner/partners/browser-data':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const plan = await partnerBrowserPlan(ctx, url, req, _)
      if (!plan) return text(_('backend.error.forbidden.title'), { status: 403 })
      const data = await optimizedDirectoryData(ctx, url, req)
      return json({
        rows: projectBrowserRows(plan.resources[plan.screen.primary]!, data.rows),
        total: data.total,
      })
    },

  '/admin/partner/partners':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const prototype = url.searchParams.get('prototype')
      if (prototype === 'ssr-matched' || prototype === 'csr-two-stage' || prototype === 'csr-planned')
        return browserPrototype(ctx, url, req, prototype)
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const current = pageOf(url)
      const search = searchOf(url)
      const role = url.searchParams.get('role') || undefined
      const includeArchived = url.searchParams.get('archived') === '1'
      const filter = { search, role, includeArchived }
      const [rows, total, activeTotal, inclusiveTotal, customerTotal, supplierTotal] = await Promise.all([
        ctx.call(
          'partner.listPartners',
          { ...filter, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('partner.countPartners', filter, url, req) as Promise<{ count: number }>,
        ctx.call('partner.countPartners', { search, includeArchived: false }, url, req) as Promise<{
          count: number
        }>,
        ctx.call('partner.countPartners', { search, includeArchived: true }, url, req) as Promise<{
          count: number
        }>,
        ctx.call(
          'partner.countPartners',
          { search, role: 'customer', includeArchived: false },
          url,
          req,
        ) as Promise<{ count: number }>,
        ctx.call(
          'partner.countPartners',
          { search, role: 'supplier', includeArchived: false },
          url,
          req,
        ) as Promise<{ count: number }>,
      ])
      const data: PartnerDirectoryData = {
        rows,
        total: total.count,
        activeTotal: activeTotal.count,
        inclusiveTotal: inclusiveTotal.count,
        customerTotal: customerTotal.count,
        supplierTotal: supplierTotal.count,
      }
      const selection = directorySelection(url, _, includeArchived)
      return adminPage(ctx, url, req, {
        title: 'partner_backend.screen.title',
        body: (_, frame) =>
          partnersScreen(
            _,
            rows as never,
            directoryFrame(url, _, frame, selection, rows.length, data.total),
            { selection },
            url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
            directorySummary(url, data),
            data.total,
          ),
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
        const parents = await partnerOptions(ctx, url, req)
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
      const parents = await partnerOptions(ctx, url, req)
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
