import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, deleteFrom, desc, eq, from, like, validateLayout } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import {
  canAccessSite,
  canAdministerSite,
  canCreateEntry,
  canEditEntry,
  canManageStructure,
  canPublishEntry,
} from './access.ts'
import { ensureCustomerRealm } from './customer.ts'

const SITE_ROLES = new Set(['administrator', 'editor', 'author', 'contributor'])
const MAX_JSON_BYTES = 512 * 1024
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
const cleanHost = (value: unknown): string | null => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (!raw || raw.length > 253 || raw.includes(':') || /[\s/@\\?#]/.test(raw) || hasControlCharacter(raw))
    return null
  try {
    const host = new URL(`http://${raw}`).hostname.replace(/\.$/, '')
    if (host !== raw) return null
  } catch {
    return null
  }
  const labels = raw.split('.')
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
    return null
  return raw
}
const cleanPath = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  if (
    !raw.startsWith('/') ||
    raw.length > 2048 ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    /[?#]/.test(raw) ||
    hasControlCharacter(raw)
  )
    return null
  const path = raw === '/' ? raw : raw.replace(/\/+$/, '')
  try {
    if (path.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part).toLowerCase())))
      return null
  } catch {
    return null
  }
  return path
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const page = (limit: unknown, offset: unknown, defaultLimit = 50) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : defaultLimit, 1), 100),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})
const jsonBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
const validSlug = (value: unknown): boolean => {
  const slug = String(value ?? '')
  return slug.length <= 160 && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)
}
const forbidden = () => invalid('siteId', 'website.error.forbidden')

const siteById = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const Site = ctx.table('website.Site')
  return ctx.db.one(from(Site).where(eq(Site.id, id)))
}

const entryById = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const Entry = ctx.table('website.Entry')
  return ctx.db.one(from(Entry).where(eq(Entry.id, id)))
}

const validateFields = (
  schema: Record<string, string>,
  raw: unknown,
): Array<{ field: string; message: string }> => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const errors: Array<{ field: string; message: string }> = []
  for (const key of Object.keys(value))
    if (!schema[key]) errors.push({ field: key, message: 'website.error.unknownField' })
  for (const [key, spec] of Object.entries(schema)) {
    const optional = spec.endsWith('?')
    const base = optional ? spec.slice(0, -1) : spec
    const field = value[key]
    if (field == null) {
      if (!optional) errors.push({ field: key, message: 'website.error.required' })
      continue
    }
    const valid =
      base === 'int'
        ? Number.isInteger(field)
        : base === 'float' || base === 'decimal'
          ? typeof field === 'number' || typeof field === 'string'
          : base === 'bool'
            ? typeof field === 'boolean'
            : base === 'json'
              ? typeof field === 'object'
              : typeof field === 'string'
    if (!valid) errors.push({ field: key, message: 'website.error.invalidFieldType' })
  }
  return errors
}

export const cmsFunctions: Record<string, FnSpec> = {
  resolveSite: defineFn({
    anonymous: true,
    input: { host: 'text' },
    output: { id: 'id', title: 'text', locale: 'text', theme: 'text', tokens: 'json?' },
    effects: ['read:website.Site', 'read:website.SiteDomain'],
    handler: async (ctx: Ctx, args) => {
      const host = cleanHost(args.host)
      if (!host) return null
      const Domain = ctx.table('website.SiteDomain')
      const Site = ctx.table('website.Site')
      const domain = await ctx.db.one(from(Domain).where(eq(Domain.host, host)))
      const site = domain
        ? await ctx.db.one(from(Site).where(eq(Site.id, domain.siteId), eq(Site.active, true)))
        : null
      if (!site && (await ctx.db.count(from(Site).where(eq(Site.active, true)))) === 0) {
        const fallback = Object.entries(ctx.manifest.modules).find(([, module]) => module.kind === 'theme')
        return fallback
          ? {
              id: '__legacy__',
              title: 'Website',
              locale: 'vi',
              theme: fallback[0],
              tokens: { legacy: true },
            }
          : null
      }
      return site
        ? {
            id: site.id,
            title: site.title,
            locale: site.defaultLocale,
            theme: site.theme,
            tokens: site.tokens ?? null,
          }
        : null
    },
  }),

  listSites: defineFn({
    input: { active: 'bool?' },
    output: { id: 'id', name: 'text', title: 'text', defaultLocale: 'text', theme: 'text', active: 'bool' },
    effects: ['read:website.Site', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      let query = from(Site).orderBy(asc(Site.name))
      if (args.active != null) query = query.where(eq(Site.active, args.active))
      const sites = await ctx.db.all(query)
      if (!ctx.actor) return sites
      const memberships = await ctx.db.select('website.SiteMember', { userId: ctx.actor })
      const allowed = new Set(memberships.map((row) => row.siteId))
      return sites.filter((site) => allowed.has(site.id))
    },
  }),

  saveSite: defineFn({
    input: {
      id: 'id',
      name: 'text',
      title: 'text',
      defaultLocale: 'text',
      theme: 'text',
      tokens: 'json?',
      siteGroup: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'write:website.Site',
      'write:website.SiteMember',
      'read:website.CustomerRealm',
      'write:website.CustomerRealm',
      'read:website.CustomerRealmSite',
      'write:website.CustomerRealmSite',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const selected = ctx.manifest.modules[String(args.theme)]
      if (selected?.kind !== 'theme') return invalid('theme', 'website.error.invalidTheme')
      const existing = await siteById(ctx, args.id)
      if (existing && !(await canAdministerSite(ctx, args.id))) return forbidden()
      const name = String(args.name ?? '').trim()
      const title = String(args.title ?? '').trim()
      const locale = String(args.defaultLocale ?? '').trim()
      if (!name || name.length > 120) return invalid('name', 'website.error.invalidName')
      if (!title || title.length > 200) return invalid('title', 'website.error.invalidTitle')
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale))
        return invalid('defaultLocale', 'website.error.invalidLocale')
      if (jsonBytes(args.tokens ?? {}) > 64 * 1024) return invalid('tokens', 'website.error.payloadTooLarge')
      const duplicate = (await ctx.db.select('website.Site')).find(
        (site) => site.id !== args.id && String(site.name).toLowerCase() === name.toLowerCase(),
      )
      if (duplicate) return invalid('name', 'website.error.duplicateName')
      const cs = ctx
        .change('website.Site', { ...args, name, title, defaultLocale: locale }, existing)
        .cast(['id', 'name', 'title', 'defaultLocale', 'theme', 'tokens', 'siteGroup', 'active'])
        .required(['name', 'title', 'defaultLocale', 'theme'])
        .put('active', args.active ?? existing?.active ?? true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.tx(async (tx) => {
        await tx.db.commit(cs, existing ? { id: args.id } : undefined)
        await ensureCustomerRealm(tx, String(args.id), title)
        if (!existing && ctx.actor)
          await tx.db.insertIfAbsent('website.SiteMember', {
            id: randomUUID(),
            siteId: args.id,
            userId: ctx.actor,
            role: 'administrator',
          })
      })
      return { ok: true, id: args.id }
    },
  }),

  saveDomain: defineFn({
    input: { id: 'id', siteId: 'id', host: 'text', primary: 'bool?', redirectToPrimary: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website.SiteDomain',
      'write:website.SiteDomain',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      if (!(await canAdministerSite(ctx, args.siteId))) return forbidden()
      const host = cleanHost(args.host)
      if (!host) return invalid('host', 'website.error.invalidHost')
      const existing = (await ctx.db.select('website.SiteDomain', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      const Domain = ctx.table('website.SiteDomain')
      const duplicate = await ctx.db.one(from(Domain).where(eq(Domain.host, host)))
      if (duplicate && duplicate.id !== args.id) return invalid('host', 'website.error.duplicateHost')
      const row = {
        id: args.id,
        siteId: args.siteId,
        host,
        primary: args.primary === true,
        primaryKey: args.primary === true ? String(args.siteId) : null,
        redirectToPrimary: args.redirectToPrimary !== false,
      }
      await ctx.tx(async (tx) => {
        if (row.primary) {
          const domains = await tx.db.select('website.SiteDomain', { siteId: args.siteId })
          for (const domain of domains)
            if (domain.id !== args.id && domain.primary === true)
              await tx.db.update(
                'website.SiteDomain',
                { id: domain.id },
                { primary: false, primaryKey: null },
              )
        }
        if (existing) await tx.db.update('website.SiteDomain', { id: args.id }, row)
        else await tx.db.insert('website.SiteDomain', row)
      })
      return { ok: true, id: args.id }
    },
  }),

  listDomains: defineFn({
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      host: 'text',
      primary: 'bool',
      redirectToPrimary: 'bool',
    },
    effects: ['read:website.SiteMember', 'read:website.SiteDomain'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAdministerSite(ctx, args.siteId))) return []
      const paging = page(args.limit, args.offset, 100)
      const Domain = ctx.table('website.SiteDomain')
      return ctx.db.all(
        from(Domain)
          .where(eq(Domain.siteId, args.siteId))
          .orderBy(desc(Domain.primary), asc(Domain.host))
          .limit(paging.limit)
          .offset(paging.offset),
      )
    },
  }),

  saveSiteMember: defineFn({
    input: { id: 'id', siteId: 'id', userId: 'id', role: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Site', 'read:website.SiteMember', 'write:website.SiteMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      if (!(await canAdministerSite(ctx, args.siteId))) return forbidden()
      if (!SITE_ROLES.has(String(args.role))) return invalid('role', 'website.error.invalidRole')
      const existing = (await ctx.db.select('website.SiteMember', { id: args.id }))[0]
      if (existing && (existing.siteId !== args.siteId || existing.userId !== args.userId))
        return invalid('id', 'website.error.immutableOwnership')
      const row = { id: args.id, siteId: args.siteId, userId: args.userId, role: args.role }
      if (existing) await ctx.db.update('website.SiteMember', { id: args.id }, row)
      else await ctx.db.insert('website.SiteMember', row)
      return { ok: true, id: args.id }
    },
  }),

  listSiteMembers: defineFn({
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: { id: 'id', siteId: 'id', userId: 'id', role: 'text' },
    effects: ['read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAdministerSite(ctx, args.siteId))) return []
      const paging = page(args.limit, args.offset, 100)
      const Member = ctx.table('website.SiteMember')
      return ctx.db.all(
        from(Member)
          .where(eq(Member.siteId, args.siteId))
          .orderBy(asc(Member.role), asc(Member.userId))
          .limit(paging.limit)
          .offset(paging.offset),
      )
    },
  }),

  removeSiteMember: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.SiteMember', 'write:website.SiteMember'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const member = (await ctx.db.select('website.SiteMember', { id: args.id }))[0]
      if (!member) return { ok: true, id: args.id }
      if (!(await canAdministerSite(ctx, member.siteId))) return forbidden()
      if (member.role === 'administrator') {
        const members = await ctx.db.select('website.SiteMember', { siteId: member.siteId })
        if (members.filter((row) => row.role === 'administrator').length <= 1)
          return invalid('id', 'website.error.lastAdministrator')
      }
      const Member = ctx.table('website.SiteMember')
      await ctx.db.del(deleteFrom(Member).where(eq(Member.id, args.id)))
      return { ok: true, id: args.id }
    },
  }),

  listEntries: defineFn({
    input: { siteId: 'id', type: 'text?', status: 'text?', search: 'text?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      type: 'text',
      slug: 'text',
      path: 'text',
      title: 'text',
      status: 'text',
      updatedAt: 'datetime?',
    },
    effects: ['read:website.Entry', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return []
      const Entry = ctx.table('website.Entry')
      const paging = page(args.limit, args.offset)
      let query = from(Entry)
        .where(eq(Entry.siteId, args.siteId))
        .orderBy(desc(Entry.updatedAt), asc(Entry.title))
      if (args.type) query = query.where(eq(Entry.type, args.type))
      if (args.status) query = query.where(eq(Entry.status, args.status))
      if (args.search) query = query.where(like(Entry.title, `%${String(args.search).trim().slice(0, 100)}%`))
      query = query.limit(paging.limit).offset(paging.offset)
      return ctx.db.all(query)
    },
  }),

  countEntries: defineFn({
    input: { siteId: 'id', type: 'text?', status: 'text?', search: 'text?' },
    output: { count: 'int' },
    effects: ['read:website.Entry', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return { count: 0 }
      const Entry = ctx.table('website.Entry')
      let query = from(Entry).where(eq(Entry.siteId, args.siteId))
      if (args.type) query = query.where(eq(Entry.type, args.type))
      if (args.status) query = query.where(eq(Entry.status, args.status))
      if (args.search) query = query.where(like(Entry.title, `%${String(args.search).trim().slice(0, 100)}%`))
      return { count: await ctx.db.count(query) }
    },
  }),

  getEntry: defineFn({
    input: { id: 'id' },
    output: { entry: 'json', revision: 'json?' },
    effects: ['read:website.Entry', 'read:website.EntryRevision', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.id)
      if (!entry || !(await canEditEntry(ctx, entry))) return null
      const revision = entry.currentRevisionId
        ? ((await ctx.db.select('website.EntryRevision', { id: entry.currentRevisionId }))[0] ?? null)
        : null
      return { entry, revision }
    },
  }),

  getEntryByPath: defineFn({
    anonymous: true,
    input: { siteId: 'id', path: 'text' },
    output: {
      id: 'id',
      siteId: 'id?',
      type: 'text?',
      path: 'text',
      title: 'text',
      excerpt: 'text?',
      layout: 'json',
      fields: 'json?',
      published: 'bool?',
    },
    effects: ['read:website.Entry', 'read:website.EntryRevision', 'read:website.Page'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const path = cleanPath(args.path)
      if (!path) return null
      if (args.siteId === '__legacy__') {
        const Page = ctx.table('website.Page')
        return ctx.db.one(from(Page).where(eq(Page.path, path), eq(Page.published, true)))
      }
      const Entry = ctx.table('website.Entry')
      const entry = await ctx.db.one(from(Entry).where(eq(Entry.siteId, args.siteId), eq(Entry.path, path)))
      if (entry?.publishedRevisionId && entry.status !== 'trash') {
        const revision = (await ctx.db.select('website.EntryRevision', { id: entry.publishedRevisionId }))[0]
        if (revision)
          return {
            id: entry.id,
            siteId: entry.siteId,
            type: entry.type,
            path: entry.path,
            title: revision.title,
            excerpt: revision.excerpt ?? null,
            layout: revision.layout,
            fields: revision.fields,
          }
      }
      return null
    },
  }),

  searchPublished: defineFn({
    anonymous: true,
    input: { siteId: 'id', q: 'text', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      type: 'text',
      path: 'text',
      title: 'text',
      excerpt: 'text?',
      publishedAt: 'datetime?',
    },
    effects: ['read:website.Entry', 'read:website.EntryRevision'],
    handler: async (ctx: Ctx, args) => {
      const term = String(args.q ?? '')
        .trim()
        .toLocaleLowerCase()
        .slice(0, 100)
      if (term.length < 2) return []
      const paging = page(args.limit, args.offset, 20)
      const Entry = ctx.table('website.Entry')
      const entries = await ctx.db.all(
        from(Entry).where(eq(Entry.siteId, args.siteId)).orderBy(desc(Entry.publishedAt)).limit(500),
      )
      const matches: Array<Record<string, unknown>> = []
      for (const entry of entries) {
        if (!entry.publishedRevisionId || entry.status === 'trash') continue
        const revision = (await ctx.db.select('website.EntryRevision', { id: entry.publishedRevisionId }))[0]
        if (!revision || revision.entryId !== entry.id) continue
        const haystack = `${String(revision.title)}\n${String(revision.excerpt ?? '')}`.toLocaleLowerCase()
        if (!haystack.includes(term)) continue
        matches.push({
          id: entry.id,
          type: entry.type,
          path: entry.path,
          title: revision.title,
          excerpt: revision.excerpt ?? null,
          publishedAt: entry.publishedAt ?? null,
        })
      }
      return matches.slice(paging.offset, paging.offset + paging.limit)
    },
  }),

  saveEntry: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      type: 'text',
      slug: 'text',
      path: 'text',
      title: 'text',
      excerpt: 'text?',
      layout: 'json',
      fields: 'json?',
      kind: 'text?',
      expectedRevisionId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', revisionId: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.EntryRevision',
      'read:website.SiteMember',
      'write:website.Entry',
      'write:website.EntryRevision',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      const existing = await entryById(ctx, args.id)
      if (existing && (existing.siteId !== args.siteId || existing.type !== args.type))
        return invalid('id', 'website.error.immutableOwnership')
      if (existing ? !(await canEditEntry(ctx, existing)) : !(await canCreateEntry(ctx, args.siteId)))
        return forbidden()
      if (
        existing &&
        args.expectedRevisionId != null &&
        args.expectedRevisionId !== existing.currentRevisionId
      )
        return invalid('expectedRevisionId', 'website.error.editConflict')
      const type = ctx.manifest.contentTypes[String(args.type)]
      if (!type) return invalid('type', 'website.error.invalidContentType')
      if (
        !Array.isArray(args.layout) ||
        args.layout.length > 100 ||
        jsonBytes(args.layout) + jsonBytes(args.fields ?? {}) > MAX_JSON_BYTES
      )
        return invalid('layout', 'website.error.payloadTooLarge')
      const layoutCheck = validateLayout(ctx.manifest, args.layout)
      if (!layoutCheck.ok) return { ok: false, errors: layoutCheck.errors }
      const fieldErrors = validateFields(type.fields, args.fields)
      if (fieldErrors.length) return { ok: false, errors: fieldErrors }
      const path = cleanPath(args.path)
      if (!path) return invalid('path', 'website.error.invalidPath')
      const slug = String(args.slug)
        .trim()
        .replace(/^\/+|\/+$/g, '')
      if (!validSlug(slug)) return invalid('slug', 'website.error.invalidSlug')
      const title = String(args.title ?? '').trim()
      const excerpt = args.excerpt == null ? null : String(args.excerpt).trim()
      if (!title || title.length > 300) return invalid('title', 'website.error.invalidTitle')
      if (excerpt && excerpt.length > 2_000) return invalid('excerpt', 'website.error.payloadTooLarge')
      const Entry = ctx.table('website.Entry')
      const pathOwner = await ctx.db.one(
        from(Entry).where(eq(Entry.siteId, args.siteId), eq(Entry.path, path)),
      )
      if (pathOwner && pathOwner.id !== args.id) return invalid('path', 'website.error.duplicatePath')
      const slugOwner = await ctx.db.one(
        from(Entry).where(eq(Entry.siteId, args.siteId), eq(Entry.type, args.type), eq(Entry.slug, slug)),
      )
      if (slugOwner && slugOwner.id !== args.id) return invalid('slug', 'website.error.duplicateSlug')
      const revisions = await ctx.db.select('website.EntryRevision', { entryId: args.id })
      const version = revisions.reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1
      const revisionId = randomUUID()
      const saved = await ctx.tx(async (tx) => {
        const entry = {
          id: args.id,
          siteId: args.siteId,
          type: args.type,
          slug,
          path,
          title,
          excerpt,
          status: existing?.status === 'trash' || !existing ? 'draft' : existing.status,
          currentRevisionId: revisionId,
          publishedRevisionId: existing?.publishedRevisionId ?? null,
          scheduledRevisionId: existing?.scheduledRevisionId ?? null,
          authorId: existing?.authorId ?? ctx.actor,
          publishAt: existing?.publishAt ?? null,
          publishedAt: existing?.publishedAt ?? null,
        }
        if (existing) {
          const changed = await tx.db.compareAndSet(
            'website.Entry',
            { id: args.id },
            { currentRevisionId: existing.currentRevisionId },
            entry,
          )
          if (!('dryRun' in changed) && !changed.matched) return false
        } else {
          const inserted = await tx.db.insertIfAbsent('website.Entry', entry)
          if (!('dryRun' in inserted) && !inserted.inserted) return false
        }
        await tx.db.insert('website.EntryRevision', {
          id: revisionId,
          entryId: args.id,
          version,
          kind: args.kind === 'autosave' ? 'autosave' : 'revision',
          title,
          excerpt,
          layout: args.layout,
          fields: args.fields ?? {},
          authorId: ctx.actor,
          createdAt: new Date().toISOString(),
        })
        return true
      })
      if (!saved) return invalid('expectedRevisionId', 'website.error.editConflict')
      return { ok: true, id: args.id, revisionId, version }
    },
  }),

  publishEntry: defineFn({
    input: { id: 'id', publishAt: 'datetime?', expectedRevisionId: 'id?' },
    output: { ok: 'bool', id: 'id?', status: 'text?', errors: 'json?' },
    effects: [
      'read:website.Entry',
      'read:website.SiteMember',
      'write:website.Entry',
      'enqueue:website.publishScheduled',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.id)
      if (!entry?.currentRevisionId) return invalid('id', 'website.error.revisionNotFound')
      if (!(await canPublishEntry(ctx, entry))) return forbidden()
      if (args.expectedRevisionId && args.expectedRevisionId !== entry.currentRevisionId)
        return invalid('expectedRevisionId', 'website.error.editConflict')
      const revisionId = String(entry.currentRevisionId)
      const now = new Date()
      const scheduled = args.publishAt ? new Date(String(args.publishAt)) : null
      if (scheduled && Number.isNaN(scheduled.getTime()))
        return invalid('publishAt', 'website.error.invalidDatetime')
      if (scheduled && scheduled > now) {
        const changed = await ctx.db.compareAndSet(
          'website.Entry',
          { id: args.id },
          { currentRevisionId: revisionId },
          {
            status: 'scheduled',
            scheduledRevisionId: revisionId,
            publishAt: scheduled.toISOString(),
          },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid('expectedRevisionId', 'website.error.editConflict')
        await ctx.jobs.enqueue(
          'website.publishScheduled',
          { id: args.id, revisionId },
          { runAt: scheduled, uniqueKey: `${String(args.id)}:${revisionId}` },
        )
        return { ok: true, id: args.id, status: 'scheduled' }
      }
      const changed = await ctx.db.compareAndSet(
        'website.Entry',
        { id: args.id },
        { currentRevisionId: revisionId },
        {
          status: 'published',
          publishedRevisionId: revisionId,
          scheduledRevisionId: null,
          publishAt: null,
          publishedAt: now.toISOString(),
        },
      )
      if (!('dryRun' in changed) && !changed.matched)
        return invalid('expectedRevisionId', 'website.error.editConflict')
      return { ok: true, id: args.id, status: 'published' }
    },
  }),

  listRevisions: defineFn({
    input: { entryId: 'id', limit: 'int?', offset: 'int?' },
    output: { id: 'id', entryId: 'id', version: 'int', kind: 'text', authorId: 'id?', createdAt: 'datetime' },
    effects: ['read:website.Entry', 'read:website.EntryRevision', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry || !(await canEditEntry(ctx, entry))) return []
      const Revision = ctx.table('website.EntryRevision')
      const paging = page(args.limit, args.offset)
      return ctx.db.all(
        from(Revision)
          .where(eq(Revision.entryId, args.entryId))
          .orderBy(desc(Revision.version))
          .limit(paging.limit)
          .offset(paging.offset),
      )
    },
  }),

  restoreRevision: defineFn({
    input: { entryId: 'id', revisionId: 'id' },
    output: { ok: 'bool', id: 'id?', revisionId: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:website.Entry',
      'read:website.EntryRevision',
      'read:website.SiteMember',
      'write:website.Entry',
      'write:website.EntryRevision',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry || !(await canEditEntry(ctx, entry))) return forbidden()
      const revision = (
        await ctx.db.select('website.EntryRevision', { id: args.revisionId, entryId: args.entryId })
      )[0]
      if (!revision) return invalid('revisionId', 'website.error.revisionNotFound')
      const revisions = await ctx.db.select('website.EntryRevision', { entryId: args.entryId })
      const version = revisions.reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1
      const revisionId = randomUUID()
      const restored = await ctx.tx(async (tx) => {
        const changed = await tx.db.compareAndSet(
          'website.Entry',
          { id: args.entryId },
          { currentRevisionId: entry.currentRevisionId },
          {
            currentRevisionId: revisionId,
            title: revision.title,
            excerpt: revision.excerpt ?? null,
            status: entry.status === 'trash' ? 'draft' : entry.status,
          },
        )
        if (!('dryRun' in changed) && !changed.matched) return false
        await tx.db.insert('website.EntryRevision', {
          id: revisionId,
          entryId: args.entryId,
          version,
          kind: 'restore',
          title: revision.title,
          excerpt: revision.excerpt ?? null,
          layout: revision.layout,
          fields: revision.fields,
          authorId: ctx.actor,
          createdAt: new Date().toISOString(),
        })
        return true
      })
      return restored
        ? { ok: true, id: args.entryId, revisionId, version }
        : invalid('revisionId', 'website.error.editConflict')
    },
  }),

  createPreviewToken: defineFn({
    input: { entryId: 'id', ttlSeconds: 'int?', oneTime: 'bool?' },
    output: { token: 'text', expiresAt: 'datetime' },
    effects: ['read:website.Entry', 'read:website.SiteMember', 'write:website.PreviewToken'],
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry?.currentRevisionId) throw new Error('entry has no revision')
      if (!(await canEditEntry(ctx, entry))) throw new Error('website.error.forbidden')
      const ttl = Math.min(Math.max(Number(args.ttlSeconds ?? 900), 60), 3600)
      const token = randomBytes(24).toString('base64url')
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
      await ctx.db.insert('website.PreviewToken', {
        id: randomUUID(),
        entryId: args.entryId,
        revisionId: entry.currentRevisionId,
        digest: digest(token),
        expiresAt,
        createdBy: ctx.actor,
        oneTime: args.oneTime === true,
        usedAt: null,
        revokedAt: null,
      })
      return { token, expiresAt }
    },
  }),

  previewEntry: defineFn({
    anonymous: true,
    input: { token: 'text' },
    output: { entry: 'json', revision: 'json' },
    effects: [
      'read:website.PreviewToken',
      'write:website.PreviewToken',
      'read:website.Entry',
      'read:website.EntryRevision',
    ],
    handler: async (ctx: Ctx, args) => {
      const Token = ctx.table('website.PreviewToken')
      const token = await ctx.db.one(from(Token).where(eq(Token.digest, digest(String(args.token)))))
      if (
        !token ||
        token.revokedAt ||
        (token.oneTime === true && token.usedAt) ||
        new Date(String(token.expiresAt)) <= new Date()
      )
        return null
      const entry = await entryById(ctx, token.entryId)
      const revision = (await ctx.db.select('website.EntryRevision', { id: token.revisionId }))[0]
      if (!entry || !revision || revision.entryId !== entry.id) return null
      if (token.oneTime === true) {
        const used = await ctx.db.compareAndSet(
          'website.PreviewToken',
          { id: token.id },
          { usedAt: null, revokedAt: null },
          { usedAt: new Date().toISOString() },
        )
        if (!('dryRun' in used) && !used.matched) return null
      }
      return { entry, revision }
    },
  }),

  revokePreviewTokens: defineFn({
    input: { entryId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Entry',
      'read:website.SiteMember',
      'read:website.PreviewToken',
      'write:website.PreviewToken',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry || !(await canEditEntry(ctx, entry))) return forbidden()
      const tokens = await ctx.db.select('website.PreviewToken', { entryId: args.entryId })
      const revokedAt = new Date().toISOString()
      for (const token of tokens)
        if (!token.revokedAt) await ctx.db.update('website.PreviewToken', { id: token.id }, { revokedAt })
      return { ok: true, id: args.entryId }
    },
  }),

  listTaxonomyTerms: defineFn({
    input: { siteId: 'id', taxonomy: 'text?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      taxonomy: 'text',
      slug: 'text',
      name: 'text',
      description: 'text?',
      parentId: 'id?',
    },
    effects: ['read:website.TaxonomyTerm', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return []
      const Term = ctx.table('website.TaxonomyTerm')
      const paging = page(args.limit, args.offset, 100)
      let query = from(Term).where(eq(Term.siteId, args.siteId)).orderBy(asc(Term.taxonomy), asc(Term.name))
      if (args.taxonomy) query = query.where(eq(Term.taxonomy, args.taxonomy))
      return ctx.db.all(query.limit(paging.limit).offset(paging.offset))
    },
  }),

  saveTerm: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      taxonomy: 'text',
      slug: 'text',
      name: 'text',
      description: 'text?',
      parentId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website.TaxonomyTerm',
      'write:website.TaxonomyTerm',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!ctx.manifest.taxonomies[String(args.taxonomy)])
        return invalid('taxonomy', 'website.error.invalidTaxonomy')
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      if (!(await canManageStructure(ctx, args.siteId))) return forbidden()
      if (args.parentId === args.id) return invalid('parentId', 'website.error.taxonomyCycle')
      const existing = (await ctx.db.select('website.TaxonomyTerm', { id: args.id }))[0]
      if (existing && (existing.siteId !== args.siteId || existing.taxonomy !== args.taxonomy))
        return invalid('id', 'website.error.immutableOwnership')
      const slug = String(args.slug ?? '').trim()
      const name = String(args.name ?? '').trim()
      if (!validSlug(slug)) return invalid('slug', 'website.error.invalidSlug')
      if (!name || name.length > 200) return invalid('name', 'website.error.invalidName')
      const Term = ctx.table('website.TaxonomyTerm')
      const duplicate = await ctx.db.one(
        from(Term).where(eq(Term.siteId, args.siteId), eq(Term.taxonomy, args.taxonomy), eq(Term.slug, slug)),
      )
      if (duplicate && duplicate.id !== args.id) return invalid('slug', 'website.error.duplicateSlug')
      let parentId = args.parentId ?? null
      for (let depth = 0; parentId && depth <= 100; depth += 1) {
        const parent = (await ctx.db.select('website.TaxonomyTerm', { id: parentId }))[0]
        if (!parent || parent.siteId !== args.siteId || parent.taxonomy !== args.taxonomy)
          return invalid('parentId', 'website.error.invalidParent')
        if (parent.id === args.id || depth === 100) return invalid('parentId', 'website.error.taxonomyCycle')
        parentId = parent.parentId ?? null
      }
      const row = {
        id: args.id,
        siteId: args.siteId,
        taxonomy: args.taxonomy,
        slug,
        name,
        description: args.description ?? null,
        parentId: args.parentId ?? null,
      }
      if (existing) await ctx.db.update('website.TaxonomyTerm', { id: args.id }, row)
      else await ctx.db.insert('website.TaxonomyTerm', row)
      return { ok: true, id: args.id }
    },
  }),

  assignTerm: defineFn({
    input: { id: 'id', entryId: 'id', termId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Entry',
      'read:website.SiteMember',
      'read:website.TaxonomyTerm',
      'write:website.EntryTerm',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      const term = (await ctx.db.select('website.TaxonomyTerm', { id: args.termId }))[0]
      if (!entry || !(await canEditEntry(ctx, entry))) return forbidden()
      if (!term || entry.siteId !== term.siteId) return invalid('termId', 'website.error.termSiteMismatch')
      await ctx.db.insertIfAbsent('website.EntryTerm', args)
      return { ok: true, id: args.id }
    },
  }),

  saveMediaMetadata: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      attachmentId: 'id',
      alt: 'text?',
      caption: 'text?',
      width: 'int?',
      height: 'int?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website.MediaMetadata',
      'write:website.MediaMetadata',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      if (!(await canManageStructure(ctx, args.siteId))) return forbidden()
      const existing = (await ctx.db.select('website.MediaMetadata', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      if (
        (args.width != null && (Number(args.width) <= 0 || Number(args.width) > 100_000)) ||
        (args.height != null && (Number(args.height) <= 0 || Number(args.height) > 100_000))
      )
        return invalid('width', 'website.error.invalidDimensions')
      const row = {
        ...args,
        alt: args.alt ?? null,
        caption: args.caption ?? null,
        width: args.width ?? null,
        height: args.height ?? null,
      }
      if (existing) await ctx.db.update('website.MediaMetadata', { id: args.id }, row)
      else await ctx.db.insert('website.MediaMetadata', row)
      return { ok: true, id: args.id }
    },
  }),

  listMedia: defineFn({
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      attachmentId: 'id',
      alt: 'text?',
      caption: 'text?',
      width: 'int?',
      height: 'int?',
    },
    effects: ['read:website.MediaMetadata', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return []
      const Media = ctx.table('website.MediaMetadata')
      const paging = page(args.limit, args.offset, 100)
      return ctx.db.all(
        from(Media)
          .where(eq(Media.siteId, args.siteId))
          .orderBy(asc(Media.attachmentId))
          .limit(paging.limit)
          .offset(paging.offset),
      )
    },
  }),

  saveRedirect: defineFn({
    input: { id: 'id', siteId: 'id', fromPath: 'text', toPath: 'text', permanent: 'bool?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website.Redirect',
      'write:website.Redirect',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const fromPath = cleanPath(args.fromPath)
      const toPath = cleanPath(args.toPath)
      if (!fromPath || !toPath || fromPath === toPath)
        return invalid('fromPath', 'website.error.invalidRedirect')
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'website.error.siteNotFound')
      if (!(await canManageStructure(ctx, args.siteId))) return forbidden()
      const existing = (await ctx.db.select('website.Redirect', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      const redirects = await ctx.db.select('website.Redirect', { siteId: args.siteId })
      let target: unknown = toPath
      for (let depth = 0; depth <= 20; depth += 1) {
        if (target === fromPath || depth === 20) return invalid('toPath', 'website.error.redirectCycle')
        const next = redirects.find(
          (redirect) => redirect.id !== args.id && redirect.active === true && redirect.fromPath === target,
        )
        if (!next) break
        target = next.toPath
      }
      const row = {
        id: args.id,
        siteId: args.siteId,
        fromPath,
        toPath,
        permanent: args.permanent !== false,
        active: args.active !== false,
      }
      if (existing) await ctx.db.update('website.Redirect', { id: args.id }, row)
      else await ctx.db.insert('website.Redirect', row)
      return { ok: true, id: args.id }
    },
  }),

  listRedirects: defineFn({
    input: { siteId: 'id', active: 'bool?', limit: 'int?', offset: 'int?' },
    output: { id: 'id', siteId: 'id', fromPath: 'text', toPath: 'text', permanent: 'bool', active: 'bool' },
    effects: ['read:website.Redirect', 'read:website.SiteMember'],
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return []
      const Redirect = ctx.table('website.Redirect')
      const paging = page(args.limit, args.offset, 100)
      let query = from(Redirect).where(eq(Redirect.siteId, args.siteId)).orderBy(asc(Redirect.fromPath))
      if (args.active != null) query = query.where(eq(Redirect.active, args.active))
      return ctx.db.all(query.limit(paging.limit).offset(paging.offset))
    },
  }),
}
