import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

// Both functions here are DB-only (no `Ctx.storage` — see sync.ts's header
// comment) and `exposure: 'internal'`, so the generic `/_ket/fn/` HTTP path
// refuses them outright (packages/ketjs/src/server/http.ts: "call it from
// the trusted route that owns its security policy"). routes.ts is that
// route: it writes the actual bytes via `ServeContext.storageOf`, then
// reaches these through `ctx.call`/`ctx.callUnchecked` to record the result.
export const functions: Record<string, FnSpec> = {
  'sync.resolveSnapshotKey': defineFn({
    input: { attachmentId: 'id?' },
    output: { storeKey: 'text?' },
    effects: ['read:storage.Attachment'],
    exposure: 'internal',
    handler: async (ctx, args) => {
      if (!args.attachmentId) return { storeKey: null }
      const held = (await ctx.db.select('storage.Attachment', { id: args.attachmentId }))[0]
      return { storeKey: held?.storeKey ?? null }
    },
  }),

  /**
   * Who the caller is, for a presence frame to be stamped with.
   *
   * The name comes from here rather than from the browser because a presence
   * frame is broadcast to everyone else in the document: a client that got to
   * say who it was could sit in a room under somebody else's name and watch
   * them work. `ctx.actor` is the session's own answer and cannot be asked
   * for from the route layer, which sees a `Scope` and no user at all.
   */
  'sync.viewer': defineFn({
    input: {},
    output: { id: 'text?', name: 'text?' },
    effects: ['read:user.User'],
    exposure: 'internal',
    handler: async (ctx) => {
      if (!ctx.actor) return { id: null, name: null }
      const found = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
      return { id: String(ctx.actor), name: found ? String(found.name ?? '') : null }
    },
  }),

  'sync.commitContent': defineFn({
    input: {
      issueId: 'id',
      storeKey: 'text',
      checksum: 'text',
      size: 'int',
      previewText: 'text?',
    },
    output: { ok: 'bool', attachmentId: 'id?' },
    effects: ['read:flow.Issue', 'write:flow.Issue', 'read:storage.Attachment', 'write:storage.Attachment'],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('storage.Attachment', { storeKey: args.storeKey }))[0]
      const attachmentId = existing?.id ?? randomUUID()
      if (!existing)
        await ctx.db.insertIfAbsent('storage.Attachment', {
          id: attachmentId,
          name: `flow-issue-content-${String(args.issueId)}`,
          resModel: 'flow.Issue',
          resId: args.issueId,
          resField: 'content',
          kind: 'stored',
          storeKey: args.storeKey,
          mimetype: 'application/octet-stream',
          size: args.size,
          checksum: args.checksum,
          public: false,
          createdAt: new Date().toISOString(),
        })
      await ctx.db.update(
        'flow.Issue',
        { id: args.issueId },
        {
          contentAttachmentId: attachmentId,
          previewText: args.previewText || null,
          contentUpdatedAt: new Date().toISOString(),
        },
      )
      return { ok: true, attachmentId }
    },
  }),
}
