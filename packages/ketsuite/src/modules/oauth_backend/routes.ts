import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  identitiesScreen,
  identityFormScreen,
  linkProviderScreen,
  providerFormScreen,
  providersScreen,
} from './screens/index.tsx'
import type { IdentityRow, ProviderRow } from './screens/index.tsx'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const translatedErrors = (ctx: ServeContext, url: URL, req: Req, result: unknown): string[] => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'oauth.error.required')}`,
  )
}

const providersOf = (ctx: ServeContext, url: URL, req: Req, includeArchived = false) =>
  ctx.call('oauth.listProviders', { includeArchived }, url, req) as Promise<ProviderRow[]>

const providerOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('oauth.getProvider', { id }, url, req) as Promise<ProviderRow | null>

const formOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const { companies, roles } = (await ctx.call('oauth.manageOptions', {}, url, req)) as {
    companies: AnyRow[]
    roles: AnyRow[]
  }
  return {
    companies: companies.map((row) => ({ value: String(row.id), label: String(row.name ?? row.code) })),
    roles: roles.map((row) => ({ value: String(row.id), label: String(row.name) })),
  }
}

const identityOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const [providers, { users }] = await Promise.all([
    providersOf(ctx, url, req),
    ctx.call('oauth.manageOptions', {}, url, req) as Promise<{ users: AnyRow[] }>,
  ])
  return {
    providers: providers.map((row) => ({ value: row.id, label: row.name })),
    users: users.map((row) => ({
      value: String(row.id),
      label: `${String(row.name)} · ${String(row.login)}`,
    })),
  }
}

const renderProvider = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  row: Partial<ProviderRow>,
  errors: string[] = [],
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return adminPage(ctx, url, req, {
    title: row.id ? String(row.name) : _('oauth_backend.providers.create'),
    translate: false,
    active: '/admin/oauth/providers',
    body: async (_, frame) =>
      providerFormScreen(_, row, { ...(await formOptions(ctx, url, req)), errors }, frame, localeQuery(url)),
  })
}

const providerInput = (form: Record<string, string>, id: string, url: URL) => {
  const code = form.code.trim().toLowerCase()
  return {
    id,
    code,
    name: form.name,
    protocol: form.protocol || 'oidc',
    issuer: form.issuer,
    clientId: form.clientId,
    clientAuthMethod: form.clientAuthMethod || 'none',
    clientSecretEnv: form.clientSecretEnv || undefined,
    scopes: form.scopes || 'openid profile email',
    redirectUri: form.redirectUri || `${url.origin}/auth/oauth/${encodeURIComponent(code)}/callback`,
    allowedAlgorithms: form.allowedAlgorithms || 'RS256',
    allowLinking: form.allowLinking === '1',
    autoProvision: form.autoProvision === '1',
    requireVerifiedEmail: form.requireVerifiedEmail === '1',
    defaultCompanyId: form.defaultCompanyId || undefined,
    defaultRoleId: form.defaultRoleId || undefined,
    sequence: Number(form.sequence || 10),
    active: form.active === '1',
  }
}

const renderIdentities = async (ctx: ServeContext, url: URL, req: Req, errors: string[] = []) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const providerId = url.searchParams.get('provider') ?? undefined
  const userId = url.searchParams.get('user') ?? undefined
  const rows = (await ctx.call('oauth.listIdentities', { providerId, userId }, url, req)) as IdentityRow[]
  return adminPage(ctx, url, req, {
    title: 'oauth_backend.identities.title',
    active: '/admin/oauth/identities',
    body: (_, frame) => identitiesScreen(_, rows, frame, localeQuery(url), errors),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/oauth/providers': {
    handler: (ctx: ServeContext) => async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const includeArchived = url.searchParams.get('archived') === '1'
      return adminPage(ctx, url, req, {
        title: 'oauth_backend.providers.title',
        active: '/admin/oauth/providers',
        body: async (_, frame) =>
          providersScreen(
            _,
            await providersOf(ctx, url, req, includeArchived),
            frame,
            localeQuery(url),
            includeArchived,
          ),
      })
    },
  },
  '/admin/oauth/providers/new': {
    handler: (ctx: ServeContext) => async (url, req) => {
      if (req.method === 'GET')
        return renderProvider(ctx, url, req, {
          protocol: 'oidc',
          clientAuthMethod: 'none',
          scopes: 'openid profile email',
          allowedAlgorithms: 'RS256',
          allowLinking: true,
          autoProvision: false,
          requireVerifiedEmail: true,
          sequence: 10,
          active: true,
        })
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const id = randomUUID()
      const input = providerInput(form, id, url)
      const result = await ctx.call('oauth.saveProvider', input, url, req)
      const errors = translatedErrors(ctx, url, req, result)
      return errors.length
        ? renderProvider(ctx, url, req, input, errors)
        : seeOther(inLocale(url, `/admin/oauth/providers/${id}`))
    },
  },
  '/admin/oauth/providers/{id}': {
    handler: (ctx: ServeContext) => async (url, req, params) => {
      const held = await providerOf(ctx, url, req, params.id)
      if (!held)
        return text(ctx.translate(ctx.localeOf(url, req))('oauth_backend.error.notFound'), { status: 404 })
      if (req.method === 'GET') return renderProvider(ctx, url, req, held)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const input = providerInput(form, params.id, url)
      const result = await ctx.call('oauth.saveProvider', input, url, req)
      const errors = translatedErrors(ctx, url, req, result)
      return errors.length
        ? renderProvider(ctx, url, req, { ...held, ...input }, errors)
        : seeOther(inLocale(url, `/admin/oauth/providers/${params.id}`))
    },
  },
  '/admin/oauth/providers/{id}/archive': {
    handler: (ctx: ServeContext) => async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      await ctx.call('oauth.archiveProvider', { id: params.id, active: form.action === 'restore' }, url, req)
      return seeOther(inLocale(url, `/admin/oauth/providers/${params.id}`))
    },
  },
  '/admin/oauth/identities': {
    handler: (ctx: ServeContext) => async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return renderIdentities(ctx, url, req)
    },
  },
  '/admin/oauth/identities/new': {
    handler: (ctx: ServeContext) => async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const render = async (row: Partial<IdentityRow>, errors: string[] = []) =>
        adminPage(ctx, url, req, {
          title: 'oauth_backend.identities.link',
          active: '/admin/oauth/identities',
          body: async (_, frame) =>
            identityFormScreen(
              _,
              row,
              { ...(await identityOptions(ctx, url, req)), errors },
              frame,
              localeQuery(url),
            ),
        })
      if (req.method === 'GET') return render({ providerId: url.searchParams.get('provider') ?? undefined })
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const result = await ctx.call(
        'oauth.linkIdentity',
        {
          id: randomUUID(),
          providerId: form.providerId,
          userId: form.userId,
          subject: form.subject,
          email: form.email || undefined,
          displayName: form.displayName || undefined,
          preferredUsername: form.preferredUsername || undefined,
        },
        url,
        req,
      )
      const errors = translatedErrors(ctx, url, req, result)
      return errors.length ? render(form, errors) : seeOther(inLocale(url, '/admin/oauth/identities'))
    },
  },
  '/admin/oauth/identities/{id}/unlink': {
    handler: (ctx: ServeContext) => async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const result = await ctx.call('oauth.unlinkIdentity', { id: params.id }, url, req)
      const errors = translatedErrors(ctx, url, req, result)
      return errors.length
        ? renderIdentities(ctx, url, req, errors)
        : seeOther(inLocale(url, '/admin/oauth/identities'))
    },
  },
  '/admin/oauth/link': {
    handler: (ctx: ServeContext) => async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const sessions = await ctx.sessionsOf(url, req)
      if (!(await sessions?.of(req)))
        return text(ctx.translate(ctx.localeOf(url, req))('oauth_backend.error.unauthorized'), {
          status: 401,
        })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const [providers, identities] = await Promise.all([
        ctx.call('oauth.publicProviders', {}, url, req) as Promise<
          Array<{ id: string; code: string; name: string; sequence: number }>
        >,
        ctx.call('oauth.myIdentities', {}, url, req) as Promise<IdentityRow[]>,
      ])
      return adminPage(ctx, url, req, {
        title: 'oauth_backend.link.title',
        active: '/admin/oauth/identities',
        body: (_, frame) => linkProviderScreen(_, providers, identities, frame, localeQuery(url)),
      })
    },
  },
}
