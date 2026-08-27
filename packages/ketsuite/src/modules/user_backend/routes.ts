import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, SessionContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { profileScreen } from './screens.tsx'
import { presetsScreen, rolesScreen, roleScreen, userFormScreen, usersScreen } from './screens/index.ts'
import type {
  PermissionRow,
  RoleFormValues,
  RoleRow,
  SessionRow,
  UserFormValues,
  UserRow,
} from './screens/index.ts'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'
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

const renderUser = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  state: {
    errors?: string[]
    oneTimeLink?: string | null
    integration?: Parameters<typeof userFormScreen>[2]['integration']
    values?: UserFormValues
    returnTo?: string
  } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const [row, options, sessions] = await Promise.all([
    userOf(ctx, url, req, id),
    accessOptions(ctx, url, req),
    sessionRows(ctx, url, req, id),
  ])
  if (!row) return text(_('user_backend.error.notFound'), { status: 404 })
  const returnTo = safeUserReturnTo(url, state.returnTo ?? url.searchParams.get('returnTo'))
  const values: UserFormValues = { ...row, ...state.values, id: row.id }
  const externalIdentities = await ctx.joint(url, req, 'user_backend:user.external-identities', {
    userId: id,
  })
  return adminPage(ctx, url, req, {
    title: row.name,
    translate: false,
    active: '/admin/users',
    body: (_, frame) =>
      userFormScreen(
        _,
        values,
        {
          mode: 'detail',
          action: userDetailPath(url, row.id, returnTo),
          cancelHref: returnTo,
          ...options,
          sessions,
          errors: state.errors,
          oneTimeLink: state.oneTimeLink,
          companiesAction: withUserReturnTo(
            url,
            `/admin/users/${encodeURIComponent(row.id)}/companies`,
            returnTo,
          ),
          branchesAction: withUserReturnTo(
            url,
            `/admin/users/${encodeURIComponent(row.id)}/branches`,
            returnTo,
          ),
          rolesAction: withUserReturnTo(url, `/admin/users/${encodeURIComponent(row.id)}/roles`, returnTo),
          tokenAction: withUserReturnTo(url, `/admin/users/${encodeURIComponent(row.id)}/token`, returnTo),
          sessionAction: (session) =>
            withUserReturnTo(
              url,
              `/admin/users/${encodeURIComponent(row.id)}/sessions/${encodeURIComponent(session.id)}`,
              returnTo,
            ),
          integration: state.integration ? [externalIdentities, state.integration] : externalIdentities,
        },
        frame,
      ),
  })
}

const permissionGroups = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  grants: Array<{ fnKey: string }>,
): Promise<PermissionRow[]> => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const catalogue = (await ctx.call('user.permissionCatalogue', {}, url, req)) as Array<{
    key: string
    module: string
    task: string
  }>
  const held = new Set(grants.map((grant) => grant.fnKey))
  const grouped = new Map<string, typeof catalogue>()
  for (const permission of catalogue) {
    const key = `${permission.module}:${permission.task}`
    grouped.set(key, [...(grouped.get(key) ?? []), permission])
  }
  return [...grouped.entries()].map(([key, items]) => ({
    key,
    module: items[0]!.module,
    moduleLabel: _(`${items[0]!.module}.app.title`),
    task: items[0]!.task,
    label: _(`user_backend.task.${items[0]!.task}`),
    checked: items.every((item) => held.has(item.key)),
  }))
}

const renderRole = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  state: { errors?: string[]; values?: RoleFormValues } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const row = (await ctx.call('user.getRole', { id }, url, req)) as RoleRow | null
  if (!row) return text(_('user_backend.error.roleNotFound'), { status: 404 })
  return adminPage(ctx, url, req, {
    title: state.values?.name ?? row.name,
    translate: false,
    active: '/admin/roles',
    body: async (_, frame) =>
      roleScreen(
        _,
        { ...row, ...state.values, id: row.id },
        {
          mode: 'detail',
          action: inLocale(url, `/admin/roles/${encodeURIComponent(row.id)}`),
          cancelHref: inLocale(url, '/admin/roles'),
          permissionsAction: inLocale(url, `/admin/roles/${encodeURIComponent(row.id)}/permissions`),
          permissions: await permissionGroups(ctx, url, req, row.grants ?? []),
          errors: state.errors,
        },
        frame,
      ),
  })
}

const desired = (form: Record<string, string>, prefix: string): string[] =>
  Object.keys(form)
    .filter((key) => key.startsWith(`${prefix}.`))
    .map((key) => key.slice(prefix.length + 1))

const failure = (ctx: ServeContext, url: URL, req: Req, result: unknown) =>
  text(translatedErrors(ctx, url, req, result).join('\n'), { status: 400 })

export const routes: Record<string, RouteEntry> = {
  '/admin/users':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const includeArchived = url.searchParams.get('archived') === '1'
      const search = searchOf(url) ?? ''
      const currentPage = pageOf(url)
      const locale = ctx.localeOf(url, req)
      const needle = search.toLocaleLowerCase(locale)
      const allRows = (await ctx.call('user.listUsers', { includeArchived }, url, req)) as UserRow[]
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
                ...(url.searchParams.get('lang') ? { lang: url.searchParams.get('lang')! } : {}),
              },
            },
            pager: pager(url, currentPage, rows.length, matching.length),
          }
          const returnTo = safeUserReturnTo(url, `${url.pathname}${url.search}`)
          return usersScreen(_, frame, {
            rows: rows.map((row) => ({
              ...row,
              detailHref: userDetailPath(url, row.id, returnTo),
            })),
            total: matching.length,
            createHref: withUserReturnTo(url, '/admin/users/new', returnTo),
            toggleHref: withParam(url, 'archived', includeArchived ? null : '1'),
            includeArchived,
          })
        },
      })
    },

  '/admin/users/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const returnTo = safeUserReturnTo(url, url.searchParams.get('returnTo'))
      const options = await accessOptions(ctx, url, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action !== 'save') return text('invalid action', { status: 400 })
        const id = validCreateId(form.id) ? form.id : randomUUID()
        const result = await ctx.call(
          'user.createUser',
          {
            id,
            login: form.login ?? '',
            name: form.name ?? '',
            email: form.email || null,
            partnerId: form.partnerId || null,
            accessKind: form.accessKind ?? 'internal',
            superuser: form.superuser === '1',
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(userDetailPath(url, id, returnTo))
        return adminPage(ctx, url, req, {
          title: 'user_backend.users.create',
          active: '/admin/users',
          body: (_, frame) =>
            userFormScreen(
              _,
              { ...(form as UserFormValues), id },
              {
                mode: 'create',
                action: withUserReturnTo(url, '/admin/users/new', returnTo),
                cancelHref: returnTo,
                ...options,
                errors: translatedErrors(ctx, url, req, result),
              },
              frame,
            ),
        })
      }
      const id = randomUUID()
      return adminPage(ctx, url, req, {
        title: 'user_backend.users.create',
        active: '/admin/users',
        body: (_, frame) =>
          userFormScreen(
            _,
            { id },
            {
              mode: 'create',
              action: withUserReturnTo(url, '/admin/users/new', returnTo),
              cancelHref: returnTo,
              ...options,
            },
            frame,
          ),
      })
    },

  '/admin/users/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderUser(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const before = await userOf(ctx, url, req, params.id)
      if (!before) return text('Not found', { status: 404 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const returnTo = safeUserReturnTo(url, url.searchParams.get('returnTo'))
      const result = (await ctx.call(
        'user.saveUser',
        {
          id: params.id,
          login: form.login ?? '',
          name: form.name ?? '',
          email: form.email || null,
          partnerId: form.partnerId || null,
          accessKind: form.accessKind ?? 'internal',
          active: form.active === '1',
          superuser: form.superuser === '1',
        },
        url,
        req,
      )) as { ok?: boolean; securityVersion?: number }
      if (!result.ok)
        return renderUser(ctx, url, req, params.id, {
          errors: translatedErrors(ctx, url, req, result),
          values: form as UserFormValues,
          returnTo,
        })
      if (Number(result.securityVersion) !== Number(before.securityVersion)) {
        const sessions = await ctx.sessionsOf(url, req)
        await sessions?.endUser(params.id)
      }
      return seeOther(userDetailPath(url, params.id, returnTo))
    },

  '/admin/users/{id}/companies':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const row = await userOf(ctx, url, req, params.id)
      if (!row)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.notFound'), { status: 404 })
      const form = await readForm(req)
      if (form.action !== 'save') return text('invalid action', { status: 400 })
      const selected = desired(form, 'company')
      if (!selected.length)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.companyRequired'), {
          status: 400,
        })
      for (const companyId of selected) {
        const result = await ctx.call(
          'user.grantCompany',
          { id: randomUUID(), userId: params.id, companyId },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
      }
      if (!selected.includes(String(row.defaultCompanyId ?? ''))) {
        const companyId = selected[0]!
        const branches = (await ctx.call('company.listBranches', { companyId }, url, req)) as AnyRow[]
        const root = branches.find((branch) => branch.isRoot === true)
        if (!root)
          return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.rootMissing'), {
            status: 409,
          })
        const result = await ctx.call(
          'user.setDefaultContext',
          { userId: params.id, companyId, branchId: root.id },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
      }
      for (const membership of row.memberships ?? [])
        if (!selected.includes(membership.companyId)) {
          const result = await ctx.call(
            'user.revokeCompany',
            { userId: params.id, companyId: membership.companyId },
            url,
            req,
          )
          if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
        }
      return seeOther(userDetailPath(url, params.id, safeUserReturnTo(url, url.searchParams.get('returnTo'))))
    },

  '/admin/users/{id}/branches':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const row = await userOf(ctx, url, req, params.id)
      if (!row)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.notFound'), { status: 404 })
      const form = await readForm(req)
      if (form.action !== 'save') return text('invalid action', { status: 400 })
      const selected = desired(form, 'branch')
      for (const branchId of selected) {
        const result = await ctx.call(
          'user.grantBranch',
          { id: randomUUID(), userId: params.id, branchId },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
      }
      if (!selected.includes(String(row.defaultBranchId ?? ''))) {
        const options = await accessOptions(ctx, url, req)
        const branch = options.branches.find(
          (item) => selected.includes(item.value) && item.companyId === row.defaultCompanyId,
        )
        if (!branch)
          return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.branchDefaultRequired'), {
            status: 400,
          })
        const result = await ctx.call(
          'user.setDefaultContext',
          { userId: params.id, companyId: row.defaultCompanyId, branchId: branch.value },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
      }
      for (const membership of row.branchMemberships ?? [])
        if (!selected.includes(membership.branchId)) {
          const result = await ctx.call(
            'user.revokeBranch',
            { userId: params.id, branchId: membership.branchId },
            url,
            req,
          )
          if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
        }
      return seeOther(userDetailPath(url, params.id, safeUserReturnTo(url, url.searchParams.get('returnTo'))))
    },

  '/admin/users/{id}/roles':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const row = await userOf(ctx, url, req, params.id)
      if (!row)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.notFound'), { status: 404 })
      const form = await readForm(req)
      if (form.action !== 'save') return text('invalid action', { status: 400 })
      const selected = desired(form, 'role')
      for (const roleId of selected) {
        const result = await ctx.call(
          'user.assignRole',
          { id: randomUUID(), userId: params.id, roleId },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) return failure(ctx, url, req, result)
      }
      for (const assignment of row.assignments ?? [])
        if (!selected.includes(assignment.roleId))
          await ctx.call('user.unassignRole', { userId: params.id, roleId: assignment.roleId }, url, req)
      return seeOther(userDetailPath(url, params.id, safeUserReturnTo(url, url.searchParams.get('returnTo'))))
    },

  '/admin/users/{id}/token':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const kind = form.action ?? ''
      if (kind !== 'invitation' && kind !== 'reset') return text('invalid action', { status: 400 })
      const result = (await ctx.call(
        'user.issueAuthToken',
        { userId: params.id, kind, realm: 'backend' },
        url,
        req,
      )) as { ok?: boolean; token?: string; expiresAt?: string }
      if (!result.ok || !result.token)
        return renderUser(ctx, url, req, params.id, {
          errors: translatedErrors(ctx, url, req, result),
          returnTo: safeUserReturnTo(url, url.searchParams.get('returnTo')),
        })
      if (kind === 'reset') await (await ctx.sessionsOf(url, req))?.endUser(params.id)
      await ctx.call(
        'user.recordSecurityEvent',
        { event: kind === 'reset' ? 'password.reset.issue' : 'invitation.issue', userId: params.id },
        url,
        req,
      )
      const path = `/auth/${kind}?token=${encodeURIComponent(result.token)}`
      const live = await ctx.live(req)
      const mailConnected = live.fills.some((fill) => fill.joint === 'user:auth.mail')
      const integration = mailConnected
        ? await ctx.joint(url, req, 'user:auth.mail', {
            userId: params.id,
            kind,
            token: result.token,
            expiresAt: result.expiresAt,
          })
        : undefined
      return renderUser(ctx, url, req, params.id, {
        oneTimeLink: mailConnected ? null : path,
        integration,
        returnTo: safeUserReturnTo(url, url.searchParams.get('returnTo')),
      })
    },

  '/admin/users/{id}/sessions/{sessionId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action !== 'revoke') return text('invalid action', { status: 400 })
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.sessionsUnavailable'), {
          status: 501,
        })
      const current = await sessions.of(req)
      if (!current)
        return text(ctx.translate(ctx.localeOf(url, req))('user_backend.error.unauthorized'), { status: 401 })
      // Self-service may revoke another session of the same account. Looking at
      // somebody else's sessions is an administrative operation and must cross
      // the same permission boundary as the User detail screen.
      if (params.id !== current.userId) await ctx.call('user.getUser', { id: params.id }, url, req)
      const held = (await sessions.store.listUser(params.id)).find((row) => row.id === params.sessionId)
      if (held) await sessions.store.destroy(held.id)
      await ctx.call('user.recordSecurityEvent', { event: 'session.revoke', userId: params.id }, url, req)
      return seeOther(
        params.id === current?.userId
          ? inLocale(url, '/admin/profile')
          : userDetailPath(url, params.id, safeUserReturnTo(url, url.searchParams.get('returnTo'))),
      )
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
            rows: (await rolesOf(ctx, url, req)).map((row) => ({
              ...row,
              detailHref: inLocale(url, `/admin/roles/${encodeURIComponent(row.id)}`),
            })),
            createHref: inLocale(url, '/admin/roles/new'),
            presetsHref: inLocale(url, '/admin/permission-presets'),
          }),
      })
    },

  '/admin/roles/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.action !== 'save') return text('invalid action', { status: 400 })
        const id = validCreateId(form.id) ? form.id : randomUUID()
        const result = await ctx.call(
          'user.saveRole',
          { id, name: form.name ?? '', description: form.description || null },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/roles/${encodeURIComponent(id)}`))
        return adminPage(ctx, url, req, {
          title: 'user_backend.roles.create',
          active: '/admin/roles',
          body: (_, frame) =>
            roleScreen(
              _,
              { ...form, id },
              {
                mode: 'create',
                action: inLocale(url, '/admin/roles/new'),
                cancelHref: inLocale(url, '/admin/roles'),
                errors: translatedErrors(ctx, url, req, result),
              },
              frame,
            ),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const id = randomUUID()
      return adminPage(ctx, url, req, {
        title: 'user_backend.roles.create',
        active: '/admin/roles',
        body: (_, frame) =>
          roleScreen(
            _,
            { id },
            {
              mode: 'create',
              action: inLocale(url, '/admin/roles/new'),
              cancelHref: inLocale(url, '/admin/roles'),
            },
            frame,
          ),
      })
    },

  '/admin/roles/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderRole(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const result = await ctx.call(
        'user.saveRole',
        { id: params.id, name: form.name ?? '', description: form.description || null },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/roles/${encodeURIComponent(params.id)}`))
        : renderRole(ctx, url, req, params.id, {
            errors: translatedErrors(ctx, url, req, result),
            values: form,
          })
    },

  '/admin/roles/{id}/permissions':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      if (form.action && form.action !== 'save') return text('invalid action', { status: 400 })
      const moduleName = form.module ?? ''
      const selected = new Set(desired(form, 'permission'))
      const catalogue = (await ctx.call('user.permissionCatalogue', {}, url, req)) as Array<{
        key: string
        module: string
        task: string
      }>
      const role = (await ctx.call('user.getRole', { id: params.id }, url, req)) as RoleRow
      const held = new Set(role.grants?.map((grant) => grant.fnKey) ?? [])
      for (const permission of catalogue.filter((item) => item.module === moduleName)) {
        const group = `${permission.module}:${permission.task}`
        if (selected.has(group) && !held.has(permission.key))
          await ctx.call(
            'user.grantFunction',
            { id: randomUUID(), roleId: params.id, fnKey: permission.key },
            url,
            req,
          )
        if (!selected.has(group) && held.has(permission.key))
          await ctx.call('user.revokeFunction', { roleId: params.id, fnKey: permission.key }, url, req)
      }
      return seeOther(inLocale(url, `/admin/roles/${encodeURIComponent(params.id)}`))
    },

  '/admin/permission-presets':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const catalogue = (await ctx.call('user.permissionCatalogue', {}, url, req)) as Array<{
        module: string
      }>
      const moduleNames = [...new Set(catalogue.map((item) => item.module))]
      const modules = moduleNames.map((name) => ({
        value: name,
        label: _(`${name}.app.title`),
      }))
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.action !== 'save') return text('invalid action', { status: 400 })
        const result = (await ctx.call(
          'user.applyPreset',
          { module: form.module ?? '', level: form.level ?? '' },
          url,
          req,
        )) as { ok?: boolean; granted?: number; roleId?: string }
        if (!result.ok)
          return adminPage(ctx, url, req, {
            title: 'user_backend.presets.title',
            active: '/admin/roles',
            body: (_, frame) =>
              presetsScreen(_, frame, {
                modules,
                action: inLocale(url, '/admin/permission-presets'),
                values: form,
                errors: translatedErrors(ctx, url, req, result),
              }),
          })
        const next = new URL(inLocale(url, '/admin/permission-presets'), url)
        next.searchParams.set('appliedRole', result.roleId ?? '')
        next.searchParams.set('granted', String(result.granted ?? 0))
        return seeOther(`${next.pathname}${next.search}`)
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const appliedRole = url.searchParams.get('appliedRole')
      const granted = url.searchParams.get('granted')
      return adminPage(ctx, url, req, {
        title: 'user_backend.presets.title',
        active: '/admin/roles',
        body: (_, frame) =>
          presetsScreen(_, frame, {
            modules,
            action: inLocale(url, '/admin/permission-presets'),
            result: appliedRole ? `${appliedRole}: ${granted ?? 0}` : undefined,
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
        body: async (_, frame) =>
          profileScreen(
            _,
            row,
            await sessionRows(ctx, url, req, row.id),
            frame,
            localeQuery(url),
            undefined,
            await ctx.joint(url, req, 'user_backend:profile.external-identities', { userId: row.id }),
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
          body: async (_, frame) =>
            profileScreen(
              _,
              row,
              await sessionRows(ctx, url, req, row.id),
              frame,
              localeQuery(url),
              translatedErrors(ctx, url, req, result),
              await ctx.joint(url, req, 'user_backend:profile.external-identities', { userId: row.id }),
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
