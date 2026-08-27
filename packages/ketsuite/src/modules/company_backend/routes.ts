import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { adminPage, inLocale, localeQuery, localized } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { branchFormScreen, companiesListScreen, companyFormScreen, hierarchyScreen } from './screens/index.ts'
import type {
  BranchFormValues,
  BranchRow,
  CompanyFormValues,
  CompanyHierarchyRow,
  CompanyRow,
} from './screens/index.ts'
import { contextScreen } from './screens.tsx'

const translatedErrors = (result: unknown, _: ReturnType<ServeContext['translate']>): string[] =>
  ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'company.error.invalid')}`,
  )

const dataForCompanyForm = async (ctx: ServeContext, url: URL, req: Req, id?: string) => {
  const [partners, companies] = await Promise.all([
    ctx.call('partner.listPartners', { kind: 'company', includeArchived: false }, url, req) as Promise<
      AnyRow[]
    >,
    ctx.call('company.listCompanies', { includeArchived: true }, url, req) as Promise<CompanyRow[]>,
  ])
  const claimed = new Set(
    companies.filter((company) => company.id !== id).map((company) => company.partnerId),
  )
  return {
    partners: partners
      .filter((partner) => !claimed.has(String(partner.id)))
      .map((partner) => ({ value: String(partner.id), label: String(partner.name) })),
    parents: companies
      .filter((company) => company.id !== id && company.active)
      .map((company) => ({ value: company.id, label: company.name })),
  }
}

const companyOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('company.getCompany', { id }, url, req) as Promise<(CompanyRow & { branches: BranchRow[] }) | null>

const safeReturnTo = (url: URL, submitted?: string | null): string => {
  const fallback = inLocale(url, '/admin/companies')
  if (!submitted?.startsWith('/')) return fallback
  const target = new URL(submitted, 'http://ket.local')
  if (target.origin !== 'http://ket.local' || target.pathname !== '/admin/companies') return fallback
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  else target.searchParams.delete('lang')
  return `${target.pathname}${target.search}`
}

const withReturnTo = (url: URL, path: string, returnTo: string): string => {
  const target = new URL(inLocale(url, path), 'http://ket.local')
  target.searchParams.set('returnTo', returnTo)
  return `${target.pathname}${target.search}`
}

const companyDetailPath = (url: URL, id: string, returnTo: string): string =>
  withReturnTo(url, `/admin/companies/${encodeURIComponent(id)}`, returnTo)

const companyCreatePath = (url: URL, returnTo: string): string =>
  withReturnTo(url, '/admin/companies/new', returnTo)

const companyValues = (form: Record<string, string>, id?: string): CompanyFormValues => ({
  ...(id ? { id } : {}),
  code: form.code,
  partnerId: form.partnerId,
  parentId: form.parentId || null,
  currency: form.currency,
})

const expectedVersion = (value?: string): number | undefined =>
  value === undefined ? undefined : /^\d+$/.test(value) ? Number(value) : -1

const validCreateId = (value?: string): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const renderCompany = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  options: { errors?: string[]; values?: CompanyFormValues; returnTo?: string } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const [row, form] = await Promise.all([companyOf(ctx, url, req, id), dataForCompanyForm(ctx, url, req, id)])
  if (!row) return text(_('company_backend.error.notFound'), { status: 404 })
  const lang = ctx.localeOf(url, req)
  const returnTo = safeReturnTo(url, options.returnTo ?? url.searchParams.get('returnTo'))
  const values: CompanyFormValues = {
    ...row,
    ...options.values,
    id: row.id,
    name: row.name,
    active: row.active,
    version: row.version,
  }
  const collaboration = await ctx.joint(url, req, 'partner_backend:record.collaboration', {
    resModel: 'partner.Partner',
    resId: row.partnerId,
    lang,
  })
  const detailPath = companyDetailPath(url, row.id, returnTo)
  return adminPage(ctx, url, req, {
    title: row.name,
    translate: false,
    active: '/admin/companies',
    body: (_, frame) =>
      companyFormScreen(
        _,
        values,
        {
          mode: 'detail',
          action: detailPath,
          archiveAction: withReturnTo(
            url,
            `/admin/companies/${encodeURIComponent(row.id)}/archive`,
            returnTo,
          ),
          cancelHref: returnTo,
          returnTo,
          ...form,
          branches: row.branches,
          errors: options.errors,
          manageAddressHref: localized(
            `/admin/partner/partners/${encodeURIComponent(row.partnerId)}`,
            localeQuery(url),
          ),
          addBranchHref: localized(
            `/admin/companies/${encodeURIComponent(row.id)}/branches/new`,
            localeQuery(url),
          ),
          branchHref: (branch) =>
            localized(
              `/admin/companies/${encodeURIComponent(row.id)}/branches/${encodeURIComponent(branch.id)}`,
              localeQuery(url),
            ),
          collaboration,
        },
        frame,
      ),
  })
}

const renderCompanyCreate = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  values: CompanyFormValues,
  returnTo: string,
  errors?: string[],
) => {
  const options = await dataForCompanyForm(ctx, url, req)
  return adminPage(ctx, url, req, {
    title: 'company_backend.create.title',
    active: '/admin/companies',
    body: (_, frame) =>
      companyFormScreen(
        _,
        values,
        {
          mode: 'create',
          action: companyCreatePath(url, returnTo),
          cancelHref: returnTo,
          returnTo,
          ...options,
          errors,
        },
        frame,
      ),
  })
}

const saveCompany = (ctx: ServeContext, url: URL, req: Req, id: string, form: Record<string, string>) =>
  ctx.call(
    'company.saveCompany',
    {
      id,
      code: form.code ?? '',
      partnerId: form.partnerId ?? '',
      parentId: form.parentId || null,
      currency: form.currency ?? '',
      ...(form.expectedVersion === undefined
        ? {}
        : { expectedVersion: expectedVersion(form.expectedVersion) }),
    },
    url,
    req,
  )

const branchOf = async (ctx: ServeContext, url: URL, req: Req, companyId: string, id: string) => {
  const company = await companyOf(ctx, url, req, companyId)
  if (!company) return null
  const branch = company.branches.find((item) => item.id === id)
  return branch ? { company, branch } : null
}

const branchDetailPath = (url: URL, companyId: string, id: string): string =>
  inLocale(url, `/admin/companies/${encodeURIComponent(companyId)}/branches/${encodeURIComponent(id)}`)

const branchValues = (form: Record<string, string>, id: string): BranchFormValues => ({
  id,
  code: form.code ?? '',
  name: form.name ?? '',
  parentId: form.parentId || null,
})

const renderBranch = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  companyId: string,
  id: string,
  state: { errors?: string[]; values?: BranchFormValues } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const held = await branchOf(ctx, url, req, companyId, id)
  if (!held) return text(_('company_backend.error.branchNotFound'), { status: 404 })
  const parents = held.company.branches
    .filter((branch) => branch.id !== id && branch.active)
    .map((branch) => ({ value: branch.id, label: branch.name }))
  const values = { ...held.branch, ...state.values, id: held.branch.id }
  return adminPage(ctx, url, req, {
    title: held.branch.name,
    translate: false,
    active: '/admin/companies',
    body: (_, frame) =>
      branchFormScreen(
        _,
        held.company,
        values,
        {
          mode: 'detail',
          action: branchDetailPath(url, held.company.id, held.branch.id),
          archiveAction: localized(
            `/admin/companies/${encodeURIComponent(held.company.id)}/branches/${encodeURIComponent(held.branch.id)}/archive`,
            localeQuery(url),
          ),
          cancelHref: localized(`/admin/companies/${encodeURIComponent(held.company.id)}`, localeQuery(url)),
          parents,
          errors: state.errors,
        },
        frame,
      ),
  })
}

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

export const routes: Record<string, RouteEntry> = {
  '/admin/companies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const includeArchived = url.searchParams.get('archived') === '1'
      const search = searchOf(url) ?? ''
      const currentPage = pageOf(url)
      const locale = ctx.localeOf(url, req)
      const needle = search.toLocaleLowerCase(locale)
      const allRows = (await ctx.call('company.listCompanies', { includeArchived }, url, req)) as CompanyRow[]
      const matching = needle
        ? allRows.filter((row) =>
            [row.code, row.name, row.currency].some((value) =>
              String(value).toLocaleLowerCase(locale).includes(needle),
            ),
          )
        : allRows
      const rows = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      return adminPage(ctx, url, req, {
        title: 'company_backend.screen.title',
        active: '/admin/companies',
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: search,
              placeholder: _('company_backend.search.companies'),
              keep: {
                ...(includeArchived ? { archived: '1' } : {}),
                ...(url.searchParams.get('lang') ? { lang: url.searchParams.get('lang')! } : {}),
              },
            },
            pager: pager(url, currentPage, rows.length, matching.length),
          }
          const locale = localeQuery(url)
          const returnTo = safeReturnTo(url, `${url.pathname}${url.search}`)
          return companiesListScreen(_, frame, {
            rows: rows.map((row) => ({
              ...row,
              detailHref: companyDetailPath(url, row.id, returnTo),
            })),
            total: matching.length,
            createHref: companyCreatePath(url, returnTo),
            hierarchyHref: localized('/admin/companies/hierarchy', locale),
            toggleHref: withParam(url, 'archived', includeArchived ? null : '1'),
            includeArchived,
          })
        },
      })
    },

  '/admin/companies/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const requestedReturnTo = safeReturnTo(url, url.searchParams.get('returnTo'))
      if (req.method === 'POST') {
        const form = await readForm(req)
        // The new-record form always names its command. Only the established
        // detail endpoint keeps accepting an absent action for old clients.
        if (form.action !== 'save') return text('invalid action', { status: 400 })
        const returnTo = safeReturnTo(url, form.returnTo ?? requestedReturnTo)
        const id = validCreateId(form.id) ? form.id : randomUUID()
        const result = await saveCompany(ctx, url, req, id, form)
        if ((result as { ok?: boolean }).ok) return seeOther(companyDetailPath(url, id, returnTo))
        return renderCompanyCreate(
          ctx,
          url,
          req,
          companyValues(form, id),
          returnTo,
          translatedErrors(result, _),
        )
      }
      return renderCompanyCreate(ctx, url, req, { id: randomUUID() }, requestedReturnTo)
    },

  '/admin/companies/hierarchy':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const companies = (await ctx.call(
        'company.listCompanies',
        { includeArchived: true },
        url,
        req,
      )) as CompanyRow[]
      const byParent = new Map<string, CompanyRow[]>()
      for (const company of companies) {
        const parent = company.parentId ?? ''
        byParent.set(parent, [...(byParent.get(parent) ?? []), company])
      }
      const names = new Map(companies.map((company) => [company.id, company.name]))
      const rows: CompanyHierarchyRow[] = []
      const visited = new Set<string>()
      const walk = (parent: string, depth: number) => {
        for (const company of byParent.get(parent) ?? []) {
          if (visited.has(company.id)) continue
          visited.add(company.id)
          rows.push({
            ...company,
            depth,
            parentName: company.parentId ? names.get(company.parentId) : null,
            detailHref: localized(`/admin/companies/${encodeURIComponent(company.id)}`, localeQuery(url)),
          })
          walk(company.id, depth + 1)
        }
      }
      walk('', 0)
      for (const company of companies) if (!visited.has(company.id)) walk(company.parentId ?? '', 0)
      return adminPage(ctx, url, req, {
        title: 'company_backend.hierarchy.title',
        active: '/admin/companies',
        body: (_, frame) =>
          hierarchyScreen(_, frame, {
            rows,
            companiesHref: localized('/admin/companies', localeQuery(url)),
            createHref: localized('/admin/companies/new', localeQuery(url)),
          }),
      })
    },

  '/admin/companies/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderCompany(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const returnTo = safeReturnTo(url, form.returnTo ?? url.searchParams.get('returnTo'))
      const result = await saveCompany(ctx, url, req, params.id, form)
      if ((result as { ok?: boolean }).ok) return seeOther(companyDetailPath(url, params.id, returnTo))
      return renderCompany(ctx, url, req, params.id, {
        errors: translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
        values: companyValues(form),
        returnTo,
      })
    },

  '/admin/companies/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action !== 'archive' && form.action !== 'restore')
        return text('invalid action', { status: 400 })
      const returnTo = safeReturnTo(url, form.returnTo ?? url.searchParams.get('returnTo'))
      const result = await ctx.call(
        'user.archiveCompany',
        {
          id: params.id,
          active: form.action === 'restore',
          ...(form.expectedVersion === undefined
            ? {}
            : { expectedVersion: expectedVersion(form.expectedVersion) }),
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok) return seeOther(companyDetailPath(url, params.id, returnTo))
      return renderCompany(ctx, url, req, params.id, {
        errors: translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
        returnTo,
      })
    },

  '/admin/companies/{id}/branches/new':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const company = await companyOf(ctx, url, req, params.id)
      if (!company) return text(_('company_backend.error.notFound'), { status: 404 })
      const parents = company.branches
        .filter((branch) => branch.active)
        .map((branch) => ({ value: branch.id, label: branch.name }))
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.action !== 'save') return text('invalid action', { status: 400 })
        const id = validCreateId(form.id) ? form.id : randomUUID()
        const result = await ctx.call(
          'company.saveBranch',
          {
            id,
            companyId: company.id,
            code: form.code ?? '',
            name: form.name ?? '',
            parentId: form.parentId || null,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(branchDetailPath(url, company.id, id))
        return adminPage(ctx, url, req, {
          title: 'company_backend.branch.createTitle',
          active: '/admin/companies',
          body: (_, frame) =>
            branchFormScreen(
              _,
              company,
              branchValues(form, id),
              {
                mode: 'create',
                action: localized(
                  `/admin/companies/${encodeURIComponent(company.id)}/branches/new`,
                  localeQuery(url),
                ),
                cancelHref: localized(`/admin/companies/${encodeURIComponent(company.id)}`, localeQuery(url)),
                parents,
                errors: translatedErrors(result, _),
              },
              frame,
            ),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const id = randomUUID()
      return adminPage(ctx, url, req, {
        title: 'company_backend.branch.createTitle',
        active: '/admin/companies',
        body: (_, frame) =>
          branchFormScreen(
            _,
            company,
            { id, parentId: company.branches.find((branch) => branch.isRoot)?.id },
            {
              mode: 'create',
              action: localized(
                `/admin/companies/${encodeURIComponent(company.id)}/branches/new`,
                localeQuery(url),
              ),
              cancelHref: localized(`/admin/companies/${encodeURIComponent(company.id)}`, localeQuery(url)),
              parents,
            },
            frame,
          ),
      })
    },

  '/admin/companies/{companyId}/branches/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderBranch(ctx, url, req, params.companyId, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const held = await branchOf(ctx, url, req, params.companyId, params.id)
      if (!held) return text('Not found', { status: 404 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const result = await ctx.call(
        'company.saveBranch',
        {
          id: params.id,
          companyId: held.company.id,
          code: form.code ?? '',
          name: form.name ?? '',
          parentId: form.parentId || null,
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(branchDetailPath(url, held.company.id, held.branch.id))
      return renderBranch(ctx, url, req, params.companyId, params.id, {
        errors: translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
        values: branchValues(form, params.id),
      })
    },

  '/admin/companies/{companyId}/branches/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action !== 'archive' && form.action !== 'restore')
        return text('invalid action', { status: 400 })
      const held = await branchOf(ctx, url, req, params.companyId, params.id)
      if (!held) return text('Not found', { status: 404 })
      const result = await ctx.call(
        'user.archiveBranch',
        { id: params.id, active: form.action === 'restore' },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(branchDetailPath(url, held.company.id, held.branch.id))
      return renderBranch(ctx, url, req, params.companyId, params.id, {
        errors: translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      })
    },

  '/admin/context': {
    handler:
      (ctx: ServeContext): Route =>
      async (url, req) => {
        const sessions = await ctx.sessionsOf(url, req)
        const record = await sessions?.of(req)
        if (!sessions || !record) return text('Unauthorized', { status: 401 })
        const _ = ctx.translate(ctx.localeOf(url, req))
        const options = (await ctx.call('user.contextOptions', { userId: record.userId }, url, req)) as {
          companies: Array<{ id: string; code: string; name: string }>
          branches: Array<{
            id: string
            companyId: string
            code: string
            name: string
            isRoot?: boolean
          }>
        }
        const render = (errors?: string[]) =>
          adminPage(ctx, url, req, {
            title: 'company_backend.context.title',
            body: (_, frame) =>
              contextScreen(
                _,
                {
                  ...options,
                  selectedCompanies: record.companies,
                  selectedBranches: record.branches ?? options.branches.map((branch) => branch.id),
                  companyId: record.company ?? '',
                  branchId: record.branch ?? '',
                  errors,
                },
                frame,
                localeQuery(url),
              ),
          })
        if (req.method === 'GET') return render()
        if (req.method !== 'POST') return text('GET or POST', { status: 405 })
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = (await ctx.call(
          'user.prepareContext',
          {
            userId: record.userId,
            companyId: form.companyId ?? '',
            branchId: form.branchId ?? '',
            companies: Object.keys(form)
              .filter((key) => key.startsWith('company.'))
              .map((key) => key.slice('company.'.length)),
            branches: Object.keys(form)
              .filter((key) => key.startsWith('branch.'))
              .map((key) => key.slice('branch.'.length)),
            securityVersion: record.securityVersion,
          },
          url,
          req,
        )) as { ok?: boolean; context?: SessionContext; errors?: unknown[] }
        if (!result.ok || !result.context) return render(translatedErrors(result, _))
        if (!(await sessions.update(record, result.context)))
          return render([_('company_backend.context.conflict')])
        await ctx.call(
          'user.recordSecurityEvent',
          {
            event: 'context.switch',
            userId: record.userId,
            metadata: { company: result.context.company, branch: result.context.branch },
          },
          url,
          req,
        )
        return seeOther(inLocale(url, '/admin/context'))
      },
  },
}
