import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { newPartnerScreen, partnerDetailScreen, partnersScreen } from './screens/index.ts'
import { partnerRelationControl } from './relation-control.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

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

const renderDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  errors?: string[],
  editing = false,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const [row, parents, terms, integration] = await Promise.all([
    ctx.call('partner.getPartner', { id }, url, req) as Promise<AnyRow | null>,
    partnerOptions(ctx, url, req, id),
    ctx.call('partner.getTerms', { partnerId: id }, url, req) as Promise<AnyRow | null>,
    ctx.joint(url, req, 'partner_backend:record.actions', {
      partnerId: id,
      locale: url.searchParams.get('lang')
        ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
        : '',
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
      partnerDetailScreen(
        _,
        row as never,
        {
          parents,
          terms: terms as never,
          errors,
          integration,
          addressForms,
          parentControl,
          editing,
          activeTab: ['addresses', 'roles'].includes(url.searchParams.get('tab') ?? '')
            ? (url.searchParams.get('tab') as 'addresses' | 'roles')
            : 'overview',
        },
        frame,
        url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
      ),
  })
}

const savePartner = (ctx: ServeContext, url: URL, req: Req, id: string, form: Record<string, string>) =>
  ctx.call(
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
      const filter = { search, role, includeArchived }
      const listHref = (changes: Record<string, string | null>) => {
        const target = new URL(url)
        target.searchParams.delete('page')
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) target.searchParams.delete(key)
          else target.searchParams.set(key, value)
        }
        return `${target.pathname}${target.search}`
      }
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
      return adminPage(ctx, url, req, {
        title: 'partner_backend.screen.title',
        body: (_, frame) =>
          partnersScreen(
            _,
            rows as never,
            {
              ...frame,
              chrome: {
                layout: 'catalogue',
                section: _('partner_backend.menu.app'),
                create: {
                  label: _('partner_backend.action.create'),
                  path: inLocale(url, '/admin/partner/partners/new'),
                },
                search: {
                  name: 'q',
                  value: search ?? '',
                  placeholder: _('partner_backend.chrome.search'),
                  keep: {
                    ...(role ? { role } : {}),
                    ...(includeArchived ? { archived: '1' } : {}),
                    ...(url.searchParams.get('lang') ? { lang: url.searchParams.get('lang')! } : {}),
                  },
                  facets: role
                    ? [{ label: _(`partner.role.${role}`), without: withParam(url, 'role', null) }]
                    : [],
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
                pager: pager(url, current, rows.length, total.count),
              },
            },
            {},
            url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
            {
              total: activeTotal.count,
              customers: customerTotal.count,
              suppliers: supplierTotal.count,
              archived: Math.max(0, inclusiveTotal.count - activeTotal.count),
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
            },
          ),
      })
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
      if (req.method === 'GET') return renderDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const result = await savePartner(ctx, url, req, params.id, await readForm(req))
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
      return renderDetail(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
        true,
      )
    },

  '/admin/partner/partners/{id}/edit':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return renderDetail(ctx, url, req, params.id, undefined, true)
    },

  '/admin/partner/partners/{id}/roles':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      for (const role of ['customer', 'supplier', 'employee']) {
        if (form[role] === '1')
          await ctx.call('partner.grantRole', { id: randomUUID(), partnerId: params.id, role }, url, req)
        else await ctx.call('partner.revokeRole', { partnerId: params.id, role }, url, req)
      }
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
        : renderDetail(
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
        : renderDetail(
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
        : renderDetail(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },
}
