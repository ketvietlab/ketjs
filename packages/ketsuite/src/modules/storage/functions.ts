import { deleteFrom, defineFn, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { inlineTypes } from './policy.ts'

const input = {
  id: 'id',
  name: 'text',
  resModel: 'text?',
  resId: 'text?',
  resField: 'text?',
  kind: 'text',
  url: 'text?',
  storeKey: 'text?',
  mimetype: 'text',
  size: 'int',
  checksum: 'text?',
  public: 'bool',
  createdAt: 'datetime',
}
const output = { ...input, publicStoreKey: 'text?' }

const invalid = (message: string): never => {
  throw new KetError({ code: 'E_ATTACHMENT_INVALID', message })
}

export const functions: Record<string, FnSpec> = {
  createAttachment: defineFn({
    input: { ...input, publishCopy: 'bool?' },
    output,
    effects: ['write:storage.Attachment', 'enqueue:storage.publish'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!String(args.name).trim()) invalid('attachment name cannot be empty')
      if (Number(args.size) < 0) invalid('attachment size cannot be negative')
      if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(String(args.mimetype)))
        invalid('attachment mimetype is invalid')
      if (args.kind !== 'stored' && args.kind !== 'url') invalid('attachment kind must be stored or url')
      if (args.kind === 'stored') {
        if (!args.storeKey || !args.checksum) invalid('a stored attachment requires storeKey and checksum')
        const checksum = String(args.checksum)
        if (!/^[a-f0-9]{64}$/.test(checksum)) invalid('a stored attachment requires a SHA-256 checksum')
        const expected = `blobs/${ctx.scope.company}/${checksum.slice(0, 2)}/${checksum}`
        if (args.storeKey !== expected)
          invalid('stored attachment key does not match its company and checksum')
        if (args.url) invalid('a stored attachment cannot also carry a URL')
      }
      if (args.kind === 'url') {
        if (!args.url) invalid('a URL attachment requires url')
        let target: URL | null = null
        try {
          target = new URL(String(args.url))
        } catch {
          invalid('attachment URL is invalid')
        }
        if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:'))
          invalid('an attachment URL must use http or https')
        if (args.storeKey || args.checksum) invalid('a URL attachment cannot carry a stored object')
        // Store what was validated: the parser normalises, so the raw input and the
        // URL the checks ran against are not always the same string.
        if (target) args.url = target.href
      }
      // Publication is worker-owned, never a client-selected bucket/key. The
      // job is committed with authorized metadata, not before its permission check.
      if (args.publicStoreKey != null) invalid('publicStoreKey is managed by the publication worker')
      const { publishCopy, ...record } = args
      if (publishCopy === true && (args.public !== true || args.kind !== 'stored'))
        invalid('only a public stored attachment can request a publication copy')
      await ctx.tx(async (tx) => {
        await tx.db.insert('storage.Attachment', record as Row)
        if (publishCopy === true && inlineTypes.has(String(args.mimetype)))
          await tx.jobs.enqueue('storage.publish', { id: args.id }, { uniqueKey: `attachment:${args.id}` })
      })
      return record
    },
  }),

  getAttachment: defineFn({
    input: { id: 'id' },
    output,
    effects: ['read:storage.Attachment'],
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('storage.Attachment')
      return ctx.db.one(from(A).where(eq(A.id, args.id)))
    },
  }),

  getPublicAttachment: defineFn({
    anonymous: true,
    input: { id: 'id' },
    output,
    effects: ['read:storage.Attachment'],
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('storage.Attachment')
      return ctx.db.one(from(A).where(eq(A.id, args.id), eq(A.public, true)))
    },
  }),

  listAttachments: defineFn({
    input: { resModel: 'text', resId: 'text', resField: 'text?', limit: 'int?', offset: 'int?' },
    output,
    effects: ['read:storage.Attachment'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('storage.Attachment')
      let query = from(A).where(eq(A.resModel, args.resModel), eq(A.resId, args.resId))
      if (args.resField) query = query.where(eq(A.resField, args.resField))
      query = query.limit(Math.max(1, Math.min(100, Number(args.limit ?? 50))))
      if (args.offset) query = query.offset(Math.max(0, Number(args.offset)))
      return ctx.db.all(query)
    },
  }),

  removeAttachment: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: ['write:storage.Attachment'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('storage.Attachment')
      await ctx.db.del(deleteFrom(A).where(eq(A.id, args.id)))
      return { ok: true }
    },
  }),

  requestSweep: defineFn({
    input: { minAgeMs: 'int?' },
    output: { id: 'id', existing: 'bool' },
    effects: ['enqueue:storage.sweep'],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) =>
      ctx.jobs.enqueue('storage.sweep', args, {
        uniqueKey: `company:${ctx.scope.company ?? 'none'}`,
      }),
  }),
}
