import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  branchFormScreen,
  companiesScreen,
  companyFormScreen,
  contextScreen,
  hierarchyScreen,
} from './screens.tsx'
import type { BranchRow, CompanyRow } from './screens.tsx'

type AnyRow = Record<string, unknown>
type Req = Parameters<Route>[1]

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
  return document(
    ctx,
    url,
    req,
    row.name,
    companyFormScreen(
      _,
      row,
      { ...form, branches: row.branches, errors },
      await frameFor(ctx, url, req),
      localeSuffix(url),
    ),
  )
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
  return document(
    ctx,
    url,
    req,
    held.branch.name,
    branchFormScreen(_, held.company, held.branch, parents, await frameFor(ctx, url, req), {
      errors,
      locale: localeSuffix(url),
    }),
  )
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
      const _ = ctx.translate(ctx.localeOf(url, req))
      const includeArchived = url.searchParams.get('archived') === '1'
      const rows = (await ctx.call('company.listCompanies', { includeArchived }, url, req)) as CompanyRow[]
      return document(
        ctx,
        url,
        req,
        _('company_backend.screen.title'),
        companiesScreen(_, rows, await frameFor(ctx, url, req), localeSuffix(url), includeArchived),
      )
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
        return document(
          ctx,
          url,
          req,
          _('company_backend.create.title'),
          companyFormScreen(
            _,
            form as never,
            { ...options, errors: translatedErrors(result, _) },
            await frameFor(ctx, url, req),
            localeSuffix(url),
          ),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('company_backend.create.title'),
        companyFormScreen(_, {}, options, await frameFor(ctx, url, req), localeSuffix(url)),
      )
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
      return document(
        ctx,
        url,
        req,
        _('company_backend.hierarchy.title'),
        hierarchyScreen(_, rows, await frameFor(ctx, url, req), localeSuffix(url)),
      )
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
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/branches/${id}`))
        return document(
          ctx,
          url,
          req,
          _('company_backend.branch.createTitle'),
          branchFormScreen(_, company, form as never, parents, await frameFor(ctx, url, req), {
            errors: translatedErrors(result, _),
            locale: localeSuffix(url),
          }),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('company_backend.branch.createTitle'),
        branchFormScreen(
          _,
          company,
          { parentId: company.branches.find((branch) => branch.isRoot)?.id },
          parents,
          await frameFor(ctx, url, req),
          {
            locale: localeSuffix(url),
          },
        ),
      )
    },

  '/admin/branches/{id}':
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
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/branches/${params.id}`))
      return renderBranch(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
    },

  '/admin/branches/{id}/archive':
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
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/branches/${params.id}`))
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
          document(
            ctx,
            url,
            req,
            _('company_backend.context.title'),
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
              awaitFrame,
              localeSuffix(url),
            ),
          )
        const awaitFrame = await frameFor(ctx, url, req)
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
