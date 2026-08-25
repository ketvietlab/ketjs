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
