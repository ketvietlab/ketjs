import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { adminPage, inLocale, localeQuery, localized } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { companiesListScreen } from './screens/index.ts'
import type { BranchRow, CompanyRow } from './screens/index.ts'
import { branchFormScreen, companyFormScreen, contextScreen, hierarchyScreen } from './screens.tsx'

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

const renderCompany = async (ctx: ServeContext, url: URL, req: Req, id: string, errors?: string[]) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const [row, form] = await Promise.all([companyOf(ctx, url, req, id), dataForCompanyForm(ctx, url, req, id)])
  if (!row) return text(_('company_backend.error.notFound'), { status: 404 })
  return adminPage(ctx, url, req, {
    title: row.name,
    translate: false,
    body: (_, frame) =>
      companyFormScreen(_, row, { ...form, branches: row.branches, errors }, frame, localeQuery(url)),
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
    },
    url,
    req,
  )

const branchOf = async (ctx: ServeContext, url: URL, req: Req, id: string) => {
  const companies = (await ctx.call(
    'company.listCompanies',
    { includeArchived: true },
    url,
    req,
  )) as CompanyRow[]
  for (const company of companies) {
    const detail = await companyOf(ctx, url, req, company.id)
    if (!detail) continue
    const branch = detail.branches.find((item) => item.id === id)
    if (branch) return { company: detail, branch }
  }
  return null
}

const renderBranch = async (ctx: ServeContext, url: URL, req: Req, id: string, errors?: string[]) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const held = await branchOf(ctx, url, req, id)
  if (!held) return text(_('company_backend.error.branchNotFound'), { status: 404 })
  const parents = held.company.branches
    .filter((branch) => branch.id !== id && branch.active)
    .map((branch) => ({ value: branch.id, label: branch.name }))
  return adminPage(ctx, url, req, {
    title: held.branch.name,
    translate: false,
    body: (_, frame) =>
      branchFormScreen(_, held.company, held.branch, parents, frame, {
        errors,
        locale: localeQuery(url),
      }),
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
          return companiesListScreen(_, frame, {
            rows: rows.map((row) => ({
              ...row,
              detailHref: localized(`/admin/companies/${encodeURIComponent(row.id)}`, locale),
            })),
            total: matching.length,
            createHref: localized('/admin/companies/new', locale),
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
      const _ = ctx.translate(ctx.localeOf(url, req))
      const options = await dataForCompanyForm(ctx, url, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await saveCompany(ctx, url, req, id, form)
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/companies/${id}`))
        return adminPage(ctx, url, req, {
          title: 'company_backend.create.title',
          body: (_, frame) =>
            companyFormScreen(
              _,
              form as never,
              { ...options, errors: translatedErrors(result, _) },
              frame,
              localeQuery(url),
            ),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'company_backend.create.title',
        body: (_, frame) => companyFormScreen(_, {}, options, frame, localeQuery(url)),
      })
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
      const rows: Array<CompanyRow & { depth: number; parentName?: string | null }> = []
      const walk = (parent: string, depth: number) => {
        for (const company of byParent.get(parent) ?? []) {
          rows.push({ ...company, depth, parentName: company.parentId ? names.get(company.parentId) : null })
          walk(company.id, depth + 1)
        }
      }
      walk('', 0)
      return adminPage(ctx, url, req, {
        title: 'company_backend.hierarchy.title',
        body: (_, frame) => hierarchyScreen(_, rows, frame, localeQuery(url)),
      })
    },

  '/admin/companies/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderCompany(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const result = await saveCompany(ctx, url, req, params.id, await readForm(req))
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/companies/${params.id}`))
      return renderCompany(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
    },

  '/admin/companies/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'user.archiveCompany',
        { id: params.id, active: form.action === 'restore' },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/companies/${params.id}`))
      return renderCompany(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
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
        const form = await readForm(req)
        const id = randomUUID()
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
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/companies/${params.id}/branches/${id}`))
        return adminPage(ctx, url, req, {
          title: 'company_backend.branch.createTitle',
          body: (_, frame) =>
            branchFormScreen(_, company, form as never, parents, frame, {
              errors: translatedErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'company_backend.branch.createTitle',
        body: (_, frame) =>
          branchFormScreen(
            _,
            company,
            { parentId: company.branches.find((branch) => branch.isRoot)?.id },
            parents,
            frame,
            {
              locale: localeQuery(url),
            },
          ),
      })
    },

  '/admin/companies/{companyId}/branches/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderBranch(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const held = await branchOf(ctx, url, req, params.id)
      if (!held) return text('Not found', { status: 404 })
      const form = await readForm(req)
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
        return seeOther(inLocale(url, `/admin/companies/${params.companyId}/branches/${params.id}`))
      return renderBranch(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
    },

  '/admin/companies/{companyId}/branches/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'user.archiveBranch',
        { id: params.id, active: form.action === 'restore' },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/companies/${params.companyId}/branches/${params.id}`))
      return renderBranch(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
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
