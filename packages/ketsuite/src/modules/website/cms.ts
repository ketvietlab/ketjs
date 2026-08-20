import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from, like, validateLayout } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

const SITE_ROLES = new Set(['administrator', 'editor', 'author', 'contributor'])
const cleanHost = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
const cleanPath = (value: unknown) => {
  const path = String(value ?? '').trim()
  return path === '/' ? path : path.replace(/\/+$/, '')
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

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
    if (!schema[key]) errors.push({ field: key, message: 'unknown field' })
  for (const [key, spec] of Object.entries(schema)) {
    const optional = spec.endsWith('?')
    const base = optional ? spec.slice(0, -1) : spec
    const field = value[key]
    if (field == null) {
      if (!optional) errors.push({ field: key, message: 'required' })
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
    if (!valid) errors.push({ field: key, message: `expects ${base}` })
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
      const Domain = ctx.table('website.SiteDomain')
      const Site = ctx.table('website.Site')
      const domain = host ? await ctx.db.one(from(Domain).where(eq(Domain.host, host))) : null
      const site = domain
        ? await ctx.db.one(from(Site).where(eq(Site.id, domain.siteId), eq(Site.active, true)))
        : await ctx.db.one(from(Site).where(eq(Site.active, true)).orderBy(asc(Site.id)).limit(1))
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
    effects: ['read:website.Site'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      let query = from(Site).orderBy(asc(Site.name))
      if (args.active != null) query = query.where(eq(Site.active, args.active))
      return ctx.db.all(query)
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
    effects: ['read:website.Site', 'write:website.Site'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const selected = ctx.manifest.modules[String(args.theme)]
      if (selected?.kind !== 'theme') return invalid('theme', 'theme is not shipped')
      const existing = await siteById(ctx, args.id)
      const cs = ctx
        .change('website.Site', args, existing)
        .cast(['id', 'name', 'title', 'defaultLocale', 'theme', 'tokens', 'siteGroup', 'active'])
        .required(['name', 'title', 'defaultLocale', 'theme'])
        .put('active', args.active ?? existing?.active ?? true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  saveDomain: defineFn({
    input: { id: 'id', siteId: 'id', host: 'text', primary: 'bool?', redirectToPrimary: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Site', 'read:website.SiteDomain', 'write:website.SiteDomain'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'site does not exist')
      const host = cleanHost(args.host)
      if (!host || host.includes('/') || host.includes(':')) return invalid('host', 'invalid host')
      const existing = (await ctx.db.select('website.SiteDomain', { id: args.id }))[0]
      const row = {
        id: args.id,
        siteId: args.siteId,
        host,
        primary: args.primary === true,
        redirectToPrimary: args.redirectToPrimary !== false,
      }
      if (existing) await ctx.db.update('website.SiteDomain', { id: args.id }, row)
      else await ctx.db.insert('website.SiteDomain', row)
      return { ok: true, id: args.id }
    },
  }),

  saveSiteMember: defineFn({
    input: { id: 'id', siteId: 'id', userId: 'id', role: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Site', 'read:website.SiteMember', 'write:website.SiteMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'site does not exist')
      if (!SITE_ROLES.has(String(args.role))) return invalid('role', 'invalid site role')
      const existing = (await ctx.db.select('website.SiteMember', { id: args.id }))[0]
      const row = { id: args.id, siteId: args.siteId, userId: args.userId, role: args.role }
      if (existing) await ctx.db.update('website.SiteMember', { id: args.id }, row)
      else await ctx.db.insert('website.SiteMember', row)
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
    effects: ['read:website.Entry'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Entry = ctx.table('website.Entry')
      let query = from(Entry)
        .where(eq(Entry.siteId, args.siteId))
        .orderBy(desc(Entry.updatedAt), asc(Entry.title))
      if (args.type) query = query.where(eq(Entry.type, args.type))
      if (args.status) query = query.where(eq(Entry.status, args.status))
      if (args.search) query = query.where(like(Entry.title, `%${args.search}%`))
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
      return ctx.db.all(query)
    },
  }),

  countEntries: defineFn({
    input: { siteId: 'id', type: 'text?', status: 'text?', search: 'text?' },
    output: { count: 'int' },
    effects: ['read:website.Entry'],
    handler: async (ctx: Ctx, args) => {
      const Entry = ctx.table('website.Entry')
      let query = from(Entry).where(eq(Entry.siteId, args.siteId))
      if (args.type) query = query.where(eq(Entry.type, args.type))
      if (args.status) query = query.where(eq(Entry.status, args.status))
      if (args.search) query = query.where(like(Entry.title, `%${args.search}%`))
      return { count: await ctx.db.count(query) }
    },
  }),

  getEntry: defineFn({
    input: { id: 'id' },
    output: { entry: 'json', revision: 'json?' },
    effects: ['read:website.Entry', 'read:website.EntryRevision'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.id)
      if (!entry) return null
      const revision = entry.currentRevisionId
        ? ((await ctx.db.select('website.EntryRevision', { id: entry.currentRevisionId }))[0] ?? null)
        : null
      return { entry, revision }
    },
  }),

  getEntryByPath: defineFn({
    anonymous: true,
    input: { siteId: 'id?', path: 'text' },
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
      if (args.siteId) {
        const Entry = ctx.table('website.Entry')
        const entry = await ctx.db.one(
          from(Entry).where(
            eq(Entry.siteId, args.siteId),
            eq(Entry.path, path),
            eq(Entry.status, 'published'),
          ),
        )
        if (entry?.publishedRevisionId) {
          const revision = (
            await ctx.db.select('website.EntryRevision', { id: entry.publishedRevisionId })
          )[0]
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
      }
      const Page = ctx.table('website.Page')
      return ctx.db.one(from(Page).where(eq(Page.path, path), eq(Page.published, true)))
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
    },
    output: { ok: 'bool', id: 'id?', revisionId: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.EntryRevision',
      'write:website.Entry',
      'write:website.EntryRevision',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'site does not exist')
      const type = ctx.manifest.contentTypes[String(args.type)]
      if (!type) return invalid('type', 'content type is not registered')
      const layoutCheck = validateLayout(ctx.manifest, args.layout)
      if (!layoutCheck.ok) return { ok: false, errors: layoutCheck.errors }
      const fieldErrors = validateFields(type.fields, args.fields)
      if (fieldErrors.length) return { ok: false, errors: fieldErrors }
      const path = cleanPath(args.path)
      if (!path.startsWith('/')) return invalid('path', 'path must start with /')
      const slug = String(args.slug)
        .trim()
        .replace(/^\/+|\/+$/g, '')
      if (!slug && path !== '/') return invalid('slug', 'slug is required')
      const existing = await entryById(ctx, args.id)
      const revisions = await ctx.db.select('website.EntryRevision', { entryId: args.id })
      const version = revisions.reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1
      const revisionId = randomUUID()
      await ctx.tx(async (tx) => {
        const entry = {
          id: args.id,
          siteId: args.siteId,
          type: args.type,
          slug,
          path,
          title: args.title,
          excerpt: args.excerpt ?? null,
          status: existing?.status === 'trash' || !existing ? 'draft' : existing.status,
          currentRevisionId: revisionId,
          publishedRevisionId: existing?.publishedRevisionId ?? null,
          authorId: ctx.actor,
          publishAt: existing?.publishAt ?? null,
          publishedAt: existing?.publishedAt ?? null,
        }
        if (existing) await tx.db.update('website.Entry', { id: args.id }, entry)
        else await tx.db.insert('website.Entry', entry)
        await tx.db.insert('website.EntryRevision', {
          id: revisionId,
          entryId: args.id,
          version,
          kind: args.kind === 'autosave' ? 'autosave' : 'revision',
          title: args.title,
          excerpt: args.excerpt ?? null,
          layout: args.layout,
          fields: args.fields ?? {},
          authorId: ctx.actor,
          createdAt: new Date().toISOString(),
        })
      })
      return { ok: true, id: args.id, revisionId, version }
    },
  }),

  publishEntry: defineFn({
    input: { id: 'id', publishAt: 'datetime?' },
    output: { ok: 'bool', id: 'id?', status: 'text?', errors: 'json?' },
    effects: ['read:website.Entry', 'write:website.Entry', 'enqueue:website.publishScheduled'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.id)
      if (!entry?.currentRevisionId) return invalid('id', 'entry has no revision')
      const now = new Date()
      const scheduled = args.publishAt ? new Date(String(args.publishAt)) : null
      if (scheduled && Number.isNaN(scheduled.getTime())) return invalid('publishAt', 'invalid datetime')
      if (scheduled && scheduled > now) {
        await ctx.db.update(
          'website.Entry',
          { id: args.id },
          { status: 'scheduled', publishAt: scheduled.toISOString() },
        )
        await ctx.jobs.enqueue(
          'website.publishScheduled',
          { id: args.id },
          { runAt: scheduled, uniqueKey: String(args.id) },
        )
        return { ok: true, id: args.id, status: 'scheduled' }
      }
      await ctx.db.update(
        'website.Entry',
        { id: args.id },
        {
          status: 'published',
          publishedRevisionId: entry.currentRevisionId,
          publishAt: null,
          publishedAt: now.toISOString(),
        },
      )
      return { ok: true, id: args.id, status: 'published' }
    },
  }),

  listRevisions: defineFn({
    input: { entryId: 'id' },
    output: { id: 'id', entryId: 'id', version: 'int', kind: 'text', authorId: 'id?', createdAt: 'datetime' },
    effects: ['read:website.EntryRevision'],
    handler: async (ctx: Ctx, args) => {
      const Revision = ctx.table('website.EntryRevision')
      return ctx.db.all(
        from(Revision).where(eq(Revision.entryId, args.entryId)).orderBy(desc(Revision.version)),
      )
    },
  }),

  restoreRevision: defineFn({
    input: { entryId: 'id', revisionId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Entry', 'read:website.EntryRevision', 'write:website.Entry'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const revision = (
        await ctx.db.select('website.EntryRevision', { id: args.revisionId, entryId: args.entryId })
      )[0]
      if (!revision) return invalid('revisionId', 'revision does not exist')
      await ctx.db.update(
        'website.Entry',
        { id: args.entryId },
        {
          currentRevisionId: args.revisionId,
          title: revision.title,
          excerpt: revision.excerpt ?? null,
          status: 'draft',
        },
      )
      return { ok: true, id: args.entryId }
    },
  }),

  createPreviewToken: defineFn({
    input: { entryId: 'id', ttlSeconds: 'int?' },
    output: { token: 'text', expiresAt: 'datetime' },
    effects: ['read:website.Entry', 'write:website.PreviewToken'],
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry?.currentRevisionId) throw new Error('entry has no revision')
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
      })
      return { token, expiresAt }
    },
  }),

  previewEntry: defineFn({
    anonymous: true,
    input: { token: 'text' },
    output: { entry: 'json', revision: 'json' },
    effects: ['read:website.PreviewToken', 'read:website.Entry', 'read:website.EntryRevision'],
    handler: async (ctx: Ctx, args) => {
      const Token = ctx.table('website.PreviewToken')
      const token = await ctx.db.one(from(Token).where(eq(Token.digest, digest(String(args.token)))))
      if (!token || new Date(String(token.expiresAt)) <= new Date()) return null
      const entry = await entryById(ctx, token.entryId)
      const revision = (await ctx.db.select('website.EntryRevision', { id: token.revisionId }))[0]
      return entry && revision ? { entry, revision } : null
    },
  }),

  listTaxonomyTerms: defineFn({
    input: { siteId: 'id', taxonomy: 'text?' },
    output: {
      id: 'id',
      siteId: 'id',
      taxonomy: 'text',
      slug: 'text',
      name: 'text',
      description: 'text?',
      parentId: 'id?',
    },
    effects: ['read:website.TaxonomyTerm'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Term = ctx.table('website.TaxonomyTerm')
      let query = from(Term).where(eq(Term.siteId, args.siteId)).orderBy(asc(Term.taxonomy), asc(Term.name))
      if (args.taxonomy) query = query.where(eq(Term.taxonomy, args.taxonomy))
      return ctx.db.all(query)
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
    effects: ['read:website.Site', 'read:website.TaxonomyTerm', 'write:website.TaxonomyTerm'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!ctx.manifest.taxonomies[String(args.taxonomy)])
        return invalid('taxonomy', 'taxonomy is not registered')
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'site does not exist')
      if (args.parentId === args.id) return invalid('parentId', 'term cannot parent itself')
      const existing = (await ctx.db.select('website.TaxonomyTerm', { id: args.id }))[0]
      const row = {
        id: args.id,
        siteId: args.siteId,
        taxonomy: args.taxonomy,
        slug: String(args.slug).trim(),
        name: args.name,
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
    effects: ['read:website.Entry', 'read:website.TaxonomyTerm', 'write:website.EntryTerm'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      const term = (await ctx.db.select('website.TaxonomyTerm', { id: args.termId }))[0]
      if (!entry || !term || entry.siteId !== term.siteId)
        return invalid('termId', 'entry and term must belong to one site')
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
    effects: ['read:website.Site', 'read:website.MediaMetadata', 'write:website.MediaMetadata'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await siteById(ctx, args.siteId))) return invalid('siteId', 'site does not exist')
      const existing = (await ctx.db.select('website.MediaMetadata', { id: args.id }))[0]
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
    input: { siteId: 'id' },
    output: {
      id: 'id',
      siteId: 'id',
      attachmentId: 'id',
      alt: 'text?',
      caption: 'text?',
      width: 'int?',
      height: 'int?',
    },
    effects: ['read:website.MediaMetadata'],
    handler: async (ctx: Ctx, args) => {
      const Media = ctx.table('website.MediaMetadata')
      return ctx.db.all(from(Media).where(eq(Media.siteId, args.siteId)).orderBy(asc(Media.attachmentId)))
    },
  }),

  saveRedirect: defineFn({
    input: { id: 'id', siteId: 'id', fromPath: 'text', toPath: 'text', permanent: 'bool?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Site', 'read:website.Redirect', 'write:website.Redirect'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const fromPath = cleanPath(args.fromPath)
      const toPath = cleanPath(args.toPath)
      if (!fromPath.startsWith('/') || !toPath.startsWith('/') || fromPath === toPath)
        return invalid('fromPath', 'redirect paths must be distinct local paths')
      const existing = (await ctx.db.select('website.Redirect', { id: args.id }))[0]
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
    input: { siteId: 'id', active: 'bool?' },
    output: { id: 'id', siteId: 'id', fromPath: 'text', toPath: 'text', permanent: 'bool', active: 'bool' },
    effects: ['read:website.Redirect'],
    handler: async (ctx: Ctx, args) => {
      const Redirect = ctx.table('website.Redirect')
      let query = from(Redirect).where(eq(Redirect.siteId, args.siteId)).orderBy(asc(Redirect.fromPath))
      if (args.active != null) query = query.where(eq(Redirect.active, args.active))
      return ctx.db.all(query)
    },
  }),
}
