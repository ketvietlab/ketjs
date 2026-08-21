import { compileReportTemplate, defineFn, sha256 } from 'ketjs'
import type { FnSpec, Row } from 'ketjs'

const now = () => new Date().toISOString()
const definition = (ctx: Parameters<FnSpec['handler']>[0], id: unknown) => {
  const report = ctx.manifest.reports[String(id)]
  if (!report) throw new Error(`unknown report ${String(id)}`)
  return report
}
const templateId = (reportId: unknown) => String(reportId)
const cacheId = (reportId: unknown, recordId: unknown, locale: unknown) =>
  sha256(`${String(reportId)}\0${String(recordId)}\0${String(locale)}`).slice(0, 32)

export const functions: Record<string, FnSpec> = {
  manageTemplates: defineFn({
    input: {},
    effects: [],
    handler: () => ({ ok: true }),
  }),
  listDefinitions: defineFn({
    input: { target: 'text?' },
    effects: ['read:report.Template'],
    handler: async (ctx, args) => {
      const configured = new Map(
        (await ctx.db.select('report.Template')).map((row) => [String(row.reportId), row]),
      )
      return Object.values(ctx.manifest.reports)
        .filter((report) => !args.target || report.target === args.target)
        .map((report) => ({
          ...report,
          configured: configured.has(report.id),
          publishedVersion: configured.get(report.id)?.publishedVersion ?? 0,
          href: `/reports/${encodeURIComponent(report.id)}`,
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    },
  }),
  getTemplate: defineFn({
    input: { reportId: 'text' },
    effects: ['read:report.Template', 'read:report.TemplateVersion'],
    handler: async (ctx, args) => {
      const report = definition(ctx, args.reportId)
      const row = (await ctx.db.select('report.Template', { reportId: report.id }))[0]
      if (!row)
        return {
          reportId: report.id,
          draft: report.template,
          published: report.template,
          publishedVersion: 0,
          revision: 0,
          layout: {},
        }
      const published = row.publishedVersion
        ? (
            await ctx.db.select('report.TemplateVersion', {
              templateId: row.id,
              version: row.publishedVersion,
            })
          )[0]
        : null
      return {
        reportId: report.id,
        draft: row.draft,
        published: published?.source ?? report.template,
        publishedVersion: row.publishedVersion,
        revision: row.revision,
        layout: published?.layout ?? row.layout,
      }
    },
  }),
  listVersions: defineFn({
    input: { reportId: 'text' },
    effects: ['read:report.TemplateVersion'],
    handler: (ctx, args) =>
      ctx.db.select('report.TemplateVersion', { templateId: templateId(args.reportId) }),
  }),
  saveDraft: defineFn({
    input: { reportId: 'text', source: 'text', revision: 'int?', layout: 'json?' },
    output: { ok: 'bool', revision: 'int?', errors: 'json?' },
    effects: ['read:report.Template', 'write:report.Template'],
    idempotent: true,
    handler: async (ctx, args) => {
      const report = definition(ctx, args.reportId)
      try {
        compileReportTemplate(String(args.source), { name: report.id }).render({})
      } catch (error) {
        return {
          ok: false,
          errors: [{ field: 'source', message: error instanceof Error ? error.message : String(error) }],
        }
      }
      const id = templateId(report.id)
      const existing = (await ctx.db.select('report.Template', { id }))[0]
      if (existing && args.revision !== undefined && Number(existing.revision) !== args.revision)
        return { ok: false, errors: [{ field: 'revision', message: 'draft changed in another session' }] }
      const revision = Number(existing?.revision ?? 0) + 1
      if (existing)
        await ctx.db.update(
          'report.Template',
          { id },
          { draft: args.source, revision, layout: args.layout ?? existing.layout, updatedAt: now() },
        )
      else
        await ctx.db.insert('report.Template', {
          id,
          reportId: report.id,
          draft: args.source,
          publishedVersion: 0,
          revision,
          layout: args.layout ?? {},
          updatedAt: now(),
        })
      return { ok: true, revision }
    },
  }),
  publish: defineFn({
    input: { reportId: 'text', revision: 'int' },
    output: { ok: 'bool', version: 'int?', errors: 'json?' },
    effects: [
      'read:report.Template',
      'write:report.Template',
      'read:report.TemplateVersion',
      'write:report.TemplateVersion',
      'read:report.Cache',
      'write:report.Cache',
      'enqueue:report.purgeCache',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const report = definition(ctx, args.reportId)
      const row = (await ctx.db.select('report.Template', { id: templateId(report.id) }))[0]
      if (!row || Number(row.revision) !== args.revision)
        return {
          ok: false,
          errors: [{ field: 'revision', message: 'save the current draft before publishing' }],
        }
      try {
        compileReportTemplate(String(row.draft), { name: report.id }).render({})
      } catch (error) {
        return {
          ok: false,
          errors: [{ field: 'source', message: error instanceof Error ? error.message : String(error) }],
        }
      }
      const version = Number(row.publishedVersion) + 1
      await ctx.db.insert('report.TemplateVersion', {
        id: `${report.id}:${version}`,
        templateId: report.id,
        version,
        source: row.draft,
        layout: row.layout,
        digest: sha256(String(row.draft)),
        publishedAt: now(),
        ...(ctx.actor ? { publishedBy: ctx.actor } : {}),
      })
      await ctx.db.update(
        'report.Template',
        { id: report.id },
        { publishedVersion: version, updatedAt: now() },
      )
      for (const cache of await ctx.db.select('report.Cache', { reportId: report.id, active: true }))
        await ctx.db.update('report.Cache', { id: cache.id }, { active: false, expiresAt: now() })
      await ctx.jobs.enqueue('report.purgeCache', {}, { uniqueKey: `publish:${report.id}:${version}` })
      return { ok: true, version }
    },
  }),
  rollback: defineFn({
    input: { reportId: 'text', version: 'int' },
    output: { ok: 'bool', revision: 'int?', errors: 'json?' },
    effects: ['read:report.Template', 'write:report.Template', 'read:report.TemplateVersion'],
    idempotent: true,
    handler: async (ctx, args) => {
      const report = definition(ctx, args.reportId)
      const old = (
        await ctx.db.select('report.TemplateVersion', { templateId: report.id, version: args.version })
      )[0]
      const current = (await ctx.db.select('report.Template', { id: report.id }))[0]
      if (!old || !current)
        return { ok: false, errors: [{ field: 'version', message: 'published version does not exist' }] }
      const revision = Number(current.revision) + 1
      await ctx.db.update(
        'report.Template',
        { id: report.id },
        { draft: old.source, revision, updatedAt: now() },
      )
      return { ok: true, revision }
    },
  }),
  getCache: defineFn({
    exposure: 'internal',
    input: { reportId: 'text', recordId: 'text', locale: 'text' },
    effects: ['read:report.Cache'],
    handler: async (ctx, args) =>
      (
        await ctx.db.select('report.Cache', {
          id: cacheId(args.reportId, args.recordId, args.locale),
          active: true,
        })
      )[0] ?? null,
  }),
  storeCache: defineFn({
    exposure: 'internal',
    input: { reportId: 'text', recordId: 'text', locale: 'text', fingerprint: 'text', storageKey: 'text' },
    effects: ['read:report.Cache', 'write:report.Cache'],
    idempotent: true,
    handler: async (ctx, args) => {
      const id = cacheId(args.reportId, args.recordId, args.locale)
      const existing = (await ctx.db.select('report.Cache', { id }))[0]
      const generatedAt = now()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const values: Row = { ...args, generatedAt, expiresAt, active: true }
      if (existing) await ctx.db.update('report.Cache', { id }, values)
      else await ctx.db.insert('report.Cache', { id, ...values })
      return { id, generatedAt, expiresAt }
    },
  }),
}
