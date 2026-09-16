import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { profileScreen, rolesScreen, usersScreen } from './screens/index.ts'
import type { RoleRow, SessionRow, UserRow } from './screens/index.ts'
import { recordModalCreateHref, recordModalHref } from '../../ui/record-modal.tsx'
import type { TailMenu } from '../../ui/index.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const validCreateId = (value?: string): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const accountCreationRoute = ['/admin/users/new', 'account'].join('/')

const safeUserReturnTo = (url: URL, submitted?: string | null): string => {
  const fallback = inLocale(url, '/admin/users')
  if (!submitted?.startsWith('/')) return fallback
  const target = new URL(submitted, 'http://ket.local')
  if (target.origin !== 'http://ket.local' || target.pathname !== '/admin/users') return fallback
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  else target.searchParams.delete('lang')
  return `${target.pathname}${target.search}`
}

const withUserReturnTo = (url: URL, path: string, returnTo: string): string => {
  const target = new URL(inLocale(url, path), 'http://ket.local')
  target.searchParams.set('returnTo', returnTo)
  return `${target.pathname}${target.search}`
}

const userDetailPath = (url: URL, id: string, returnTo: string): string =>
  withUserReturnTo(url, `/admin/users/${encodeURIComponent(id)}`, returnTo)

/**
 * One narrowing question, offered beside paging.
 *
 * Choosing the row that is already chosen clears it, so the menu is both how a
 * filter is set and how it is dropped.
 */
const listFilterMenu = (
  url: URL,
  param: string,
  label: string,
  current: string,
  options: AnyRow[],
): TailMenu => ({
  id: param,
  label,
  items: options.map((option) => ({
    id: `${param}:${String(option.id)}`,
    label: String(option.name ?? option.id),
    path: withParam(url, param, current === String(option.id) ? null : String(option.id)),
    active: current === String(option.id),
  })),
})

const translatedErrors = (ctx: ServeContext, url: URL, req: Req, result: unknown): string[] => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'user.error.required')}`,
  )
}

const userOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('user.getUser', { id }, url, req) as Promise<UserRow | null>

const rolesOf = (ctx: ServeContext, url: URL, req: Req) =>
  ctx.call('user.listRoles', {}, url, req) as Promise<RoleRow[]>

const accessOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const [companies, roles] = await Promise.all([
    ctx.call('company.listCompanies', { includeArchived: false }, url, req) as Promise<AnyRow[]>,
    rolesOf(ctx, url, req),
  ])
  const branches = (
    await Promise.all(
      companies.map(
        (company) =>
          ctx.call(
            'company.listBranches',
            { companyId: company.id, includeArchived: false },
            url,
            req,
          ) as Promise<AnyRow[]>,
      ),
    )
  ).flat()
  return {
    companies: companies.map((company) => ({ value: String(company.id), label: String(company.name) })),
    branches: branches.map((branch) => ({
      value: String(branch.id),
      label: `${String(branch.code)} · ${String(branch.name)}`,
      companyId: String(branch.companyId),
    })),
    roles: roles.map((role) => ({ value: role.id, label: role.name })),
  }
}

const sessionRows = async (ctx: ServeContext, url: URL, req: Req, userId: string): Promise<SessionRow[]> => {
  const sessions = await ctx.sessionsOf(url, req)
  if (!sessions) return []
  const current = await sessions.of(req)
  return (await sessions.store.listUser(userId)).map((row) => ({
    id: row.id,
    current: row.id === current?.id,
    company: row.company,
    branch: row.branch,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }))
}

export const routes: Record<string, RouteEntry> = {
  '/admin/users':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const live = await ctx.live(req)
      if (live.routes['/admin/users/directory']) return seeOther(`/admin/users/directory${url.search}`)
      // An identity adapter that owns account creation keeps its own page; only the
      // deployments without one open the create action in the record modal.
      const deploymentCreatesAccounts = !!live.routes[accountCreationRoute]
      const _ = ctx.translate(ctx.localeOf(url, req))
      const includeArchived = url.searchParams.get('archived') === '1'
      const search = searchOf(url) ?? ''
      const currentPage = pageOf(url)
      const locale = ctx.localeOf(url, req)
      const needle = search.toLocaleLowerCase(locale)
      // Who works where and who holds what: the two questions this list is read
      // with. Both are answered by the query, because neither is on a user row.
      const companyFilter = url.searchParams.get('company') ?? ''
      const roleFilter = url.searchParams.get('role') ?? ''
      const [companies, roles] = (await Promise.all([
        ctx.call('company.listCompanies', {}, url, req),
        ctx.call('user.listRoles', {}, url, req),
      ])) as [AnyRow[], AnyRow[]]
      const allRows = (await ctx.call(
        'user.listUsers',
        {
          includeArchived,
          ...(companyFilter ? { companyId: companyFilter } : {}),
          ...(roleFilter ? { roleId: roleFilter } : {}),
        },
        url,
        req,
      )) as UserRow[]
      const matching = (
        needle
          ? allRows.filter((row) =>
              [row.name, row.login, row.email, row.accessKind].some((value) =>
                String(value ?? '')
                  .toLocaleLowerCase(locale)
                  .includes(needle),
              ),
            )
          : allRows
      ).sort(
        (left, right) =>
          left.name.localeCompare(right.name, locale) || left.login.localeCompare(right.login, locale),
      )
      const rows = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      return adminPage(ctx, url, req, {
        title: 'user_backend.users.title',
        active: '/admin/users',
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: search,
              placeholder: _('user_backend.search.users'),
              keep: {
                ...(includeArchived ? { archived: '1' } : {}),
                ...(companyFilter ? { company: companyFilter } : {}),
                ...(roleFilter ? { role: roleFilter } : {}),
                ...(url.searchParams.get('lang') ? { lang: url.searchParams.get('lang')! } : {}),
              },
              // A filter that is on says so above the table, and says it removably.
              facets: [
                ...(companyFilter
                  ? [
                      {
                        label: String(
                          companies.find((company) => String(company.id) === companyFilter)?.name ??
                            companyFilter,
                        ),
                        without: withParam(url, 'company', null),
                      },
                    ]
                  : []),
                ...(roleFilter
                  ? [
                      {
                        label: String(
                          roles.find((role) => String(role.id) === roleFilter)?.name ?? roleFilter,
                        ),
                        without: withParam(url, 'role', null),
                      },
                    ]
                  : []),
              ],
            },
            pager: pager(url, currentPage, rows.length, matching.length),
            tailMenus: [
              listFilterMenu(url, 'company', _('user_backend.field.company'), companyFilter, companies),
              listFilterMenu(url, 'role', _('user_backend.field.role'), roleFilter, roles),
            ],
          }
          const returnTo = safeUserReturnTo(url, `${url.pathname}${url.search}`)
          return usersScreen(_, frame, {
            rows: rows.map((row) => ({
              ...row,
              // A row opens the person in the record modal; the collection behind it
              // keeps its search, page and archive state.
              detailHref: recordModalHref(`${url.pathname}${url.search}`, {
                kind: 'user.user',
                id: row.id,
              }),
            })),
            total: matching.length,
            createHref: deploymentCreatesAccounts
              ? withUserReturnTo(url, '/admin/users/new', returnTo)
              : recordModalCreateHref(`${url.pathname}${url.search}`, { kind: 'user.user' }),
            toggleHref: withParam(url, 'archived', includeArchived ? null : '1'),
            includeArchived,
            clearHref: search || companyFilter || roleFilter ? inLocale(url, '/admin/users') : null,
          })
        },
      })
    },

  '/admin/roles':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      return adminPage(ctx, url, req, {
        title: 'user_backend.roles.title',
        active: '/admin/roles',
        body: async (_, frame) =>
          rolesScreen(_, frame, {
            // A row and the create action open the same record modal over this
            // collection, which is what the design system asks of a collection.
            rows: (await rolesOf(ctx, url, req)).map((row) => ({
              ...row,
              detailHref: recordModalHref(`${url.pathname}${url.search}`, {
                kind: 'user.role',
                id: row.id,
                tab: 'info',
              }),
            })),
            createHref: recordModalCreateHref(`${url.pathname}${url.search}`, { kind: 'user.role' }),
          }),
      })
    },

  '/admin/profile':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const row = (await ctx.callUnchecked('user.getUser', { id: record.userId }, url, req)) as UserRow | null
      if (!row)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      return adminPage(ctx, url, req, {
        title: 'user_backend.profile.title',
        active: '/admin/profile',
        body: async (_, frame) =>
          profileScreen(
            _,
            row,
            {
              sessions: await sessionRows(ctx, url, req, row.id),
              timezoneAction: inLocale(url, '/admin/profile/timezone'),
              passwordAction: inLocale(url, '/admin/profile/password'),
              sessionAction: (session) =>
                inLocale(
                  url,
                  `/admin/users/${encodeURIComponent(row.id)}/sessions/${encodeURIComponent(session.id)}`,
                ),
              integration: await ctx.joint(url, req, 'user_backend:profile.external-identities', {
                userId: row.id,
              }),
            },
            frame,
          ),
      })
    },

  '/admin/profile/password':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!sessions || !record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const form = await readForm(req)
      if (form.action && form.action !== 'change') return text('invalid action', { status: 400 })
      const result = (await ctx.call(
        'user.setPassword',
        {
          id: record.userId,
          currentPassword: form.currentPassword ?? '',
          newPassword: form.newPassword ?? '',
        },
        url,
        req,
      )) as { ok?: boolean; securityVersion?: number }
      if (!result.ok) {
        const row = (await ctx.callUnchecked(
          'user.getUser',
          {
            id: record.userId,
          },
          url,
          req,
        )) as UserRow | null
        if (!row)
          return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), {
            status: 401,
          })
        const _ = ctx.translate(ctx.localeOf(url, req))
        return adminPage(ctx, url, req, {
          title: 'user_backend.profile.title',
          active: '/admin/profile',
          body: async (_, frame) =>
            profileScreen(
              _,
              row,
              {
                sessions: await sessionRows(ctx, url, req, row.id),
                timezoneAction: inLocale(url, '/admin/profile/timezone'),
                passwordAction: inLocale(url, '/admin/profile/password'),
                sessionAction: (session) =>
                  inLocale(
                    url,
                    `/admin/users/${encodeURIComponent(row.id)}/sessions/${encodeURIComponent(session.id)}`,
                  ),
                passwordErrors: translatedErrors(ctx, url, req, result),
                integration: await ctx.joint(url, req, 'user_backend:profile.external-identities', {
                  userId: row.id,
                }),
              },
              frame,
            ),
        })
      }
      await sessions.endUserExcept(record.userId, record.id)
      const context: SessionContext = {
        companies: record.companies,
        company: record.company,
        branches: record.branches,
        branch: record.branch,
        securityVersion: Number(result.securityVersion ?? record.securityVersion),
      }
      if (!(await sessions.update(record, context))) return seeOther('/login')
      return seeOther(inLocale(url, '/admin/profile'))
    },

  '/admin/profile/timezone':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const sessions = await ctx.sessionsOf(url, req)
      const record = await sessions?.of(req)
      if (!record)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const result = (await ctx.callUnchecked(
        'user.setTimezone',
        { timezone: form.timezone ?? '' },
        url,
        req,
      )) as {
        ok?: boolean
      }
      return result.ok
        ? seeOther(inLocale(url, '/admin/profile'))
        : seeOther(inLocale(url, '/admin/profile?invalid=timezone'))
    },
}
