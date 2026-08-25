import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

// Recording a flattened description against its own row is the one piece of
// Live Doc that cannot be generic: effects are declared per function, and
// `write:flow.Issue` may only be declared by the module that owns the model.
// The rest — resolving a snapshot key, naming the viewer — is livedoc's (see
// modules/livedoc/functions.ts).
//
// `exposure: 'internal'`, so the generic `/_ket/fn/` HTTP path refuses it
// outright: it is called by the route that already ran its own permission
// check, through `ctx.callUnchecked`.
export const functions: Record<string, FnSpec> = {
  /**
   * The same, for a page.
   *
   * A second function rather than one that takes a model name, because the
   * effect is the point: `write:flow.Page` and `write:flow.Issue` are separate
   * capabilities, and a single generic writer would have to hold both to write
   * either. Live Doc calls whichever one the owner named.
   */
  /**
   * The commit for a project's brief.
   *
   * A fourth near-identical function rather than one that takes a model name,
   * for the reason the second one already gave: `write:flow.Project` is its own
   * capability, and a single generic writer would have to hold every model's
   * write effect to write any of them. Live Doc calls whichever one the owner
   * named, and holds none of them itself.
   */
  'sync.commitProjectContent': defineFn({
    input: { id: 'id', storeKey: 'text', checksum: 'text', size: 'int', previewText: 'text?' },
    output: { ok: 'bool', attachmentId: 'id?' },
    effects: [
      'read:flow.Project',
      'write:flow.Project',
      'read:storage.Attachment',
      'write:storage.Attachment',
    ],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('storage.Attachment', { storeKey: args.storeKey }))[0]
      const attachmentId = existing?.id ?? randomUUID()
      if (!existing)
        await ctx.db.insertIfAbsent('storage.Attachment', {
          id: attachmentId,
          name: `flow-project-content-${String(args.id)}`,
          resModel: 'flow.Project',
          resId: args.id,
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
        'flow.Project',
        { id: args.id },
        {
          contentAttachmentId: attachmentId,
          previewText: args.previewText || null,
          contentUpdatedAt: new Date().toISOString(),
        },
      )
      return { ok: true, attachmentId }
    },
  }),

  /**
   * The commit for an epic's document.
   *
   * A fourth near-identical function rather than one that takes a model name,
   * for the reason the second one already gave: `write:flow.Epic` is its own
   * capability, and a single generic writer would have to hold every model's
   * write effect to write any of them. Live Doc calls whichever one the owner
   * named, and holds none of them itself.
   */
  'sync.commitEpicContent': defineFn({
    input: { id: 'id', storeKey: 'text', checksum: 'text', size: 'int', previewText: 'text?' },
    output: { ok: 'bool', attachmentId: 'id?' },
    effects: [
      'read:flow.Epic',
      'write:flow.Epic',
      'read:storage.Attachment',
      'write:storage.Attachment',
    ],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('storage.Attachment', { storeKey: args.storeKey }))[0]
      const attachmentId = existing?.id ?? randomUUID()
      if (!existing)
        await ctx.db.insertIfAbsent('storage.Attachment', {
          id: attachmentId,
          name: `flow-epic-content-${String(args.id)}`,
          resModel: 'flow.Epic',
          resId: args.id,
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
        'flow.Epic',
        { id: args.id },
        {
          contentAttachmentId: attachmentId,
          previewText: args.previewText || null,
          contentUpdatedAt: new Date().toISOString(),
        },
      )
      return { ok: true, attachmentId }
    },
  }),

  'sync.commitPageContent': defineFn({
    input: {
      id: 'id',
      storeKey: 'text',
      checksum: 'text',
      size: 'int',
      previewText: 'text?',
    },
    output: { ok: 'bool', attachmentId: 'id?' },
    effects: ['read:flow.Page', 'write:flow.Page', 'read:storage.Attachment', 'write:storage.Attachment'],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('storage.Attachment', { storeKey: args.storeKey }))[0]
      const attachmentId = existing?.id ?? randomUUID()
      if (!existing)
        await ctx.db.insertIfAbsent('storage.Attachment', {
          id: attachmentId,
          name: `flow-page-content-${String(args.id)}`,
          resModel: 'flow.Page',
          resId: args.id,
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
        'flow.Page',
        { id: args.id },
        {
          contentAttachmentId: attachmentId,
          previewText: args.previewText || null,
          contentUpdatedAt: new Date().toISOString(),
        },
      )
      return { ok: true, attachmentId }
    },
  }),

  'sync.commitContent': defineFn({
    input: {
      id: 'id',
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
          name: `flow-issue-content-${String(args.id)}`,
          resModel: 'flow.Issue',
          resId: args.id,
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
        { id: args.id },
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
