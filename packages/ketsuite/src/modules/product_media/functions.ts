import { asc, defineFn, deleteFrom, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

const mediaOutput = {
  id: 'id',
  attachmentId: 'id',
  templateId: 'id?',
  productId: 'id?',
  alt: 'text?',
  sequence: 'int',
  primary: 'bool',
  attachment: 'json?',
}

const invalid = (message: string): never => {
  throw new KetError({ code: 'E_PRODUCT_MEDIA_INVALID', message })
}

const target = (args: { templateId?: unknown; productId?: unknown }) => {
  const templateId = args.templateId == null ? null : String(args.templateId)
  const productId = args.productId == null ? null : String(args.productId)
  if ((templateId ? 1 : 0) + (productId ? 1 : 0) !== 1)
    invalid('media must belong to exactly one product template or variant')
  return {
    templateId,
    productId,
    targetKey: `${templateId ? 'template' : 'product'}:${templateId ?? productId}`,
  }
}

const rowsFor = async (ctx: Ctx, args: { templateId?: unknown; productId?: unknown }): Promise<Row[]> => {
  const selected = target(args)
  const M = ctx.table('product_media.Media')
  const query = selected.templateId
    ? from(M).where(eq(M.templateId, selected.templateId))
    : from(M).where(eq(M.productId, selected.productId))
  return ctx.db.all(query.orderBy(asc(M.sequence), asc(M.id)).preload('attachment'))
}

const resetPrimary = async (ctx: Ctx, rows: Row[], except?: unknown): Promise<void> => {
  for (const row of rows) {
    if (row.primary === true && row.id !== except)
      await ctx.db.update('product_media.Media', { id: row.id }, { primary: false, primarySlot: null })
  }
}

export const functions: Record<string, FnSpec> = {
  listMedia: defineFn({
    input: { templateId: 'id?', productId: 'id?' },
    output: mediaOutput,
    effects: ['read:product_media.Media', 'read:storage.Attachment'],
    agent: true,
    handler: rowsFor,
  }),

  /**
   * The primary image of many targets at once.
   *
   * A catalogue page shows a thumbnail per row, and asking `listMedia` per row
   * would be one query per product plus every non-primary image none of them
   * needs. Targets are named as ids, and only the primary of each comes back.
   */
  listPrimaryMedia: defineFn({
    input: { templateIds: 'json?', productIds: 'json?' },
    output: { id: 'id', attachmentId: 'id', templateId: 'id?', productId: 'id?', alt: 'text?' },
    effects: ['read:product_media.Media'],
    agent: true,
    handler: async (ctx, args) => {
      const templateIds = new Set((Array.isArray(args.templateIds) ? args.templateIds : []).map(String))
      const productIds = new Set((Array.isArray(args.productIds) ? args.productIds : []).map(String))
      if (!templateIds.size && !productIds.size) return []
      const M = ctx.table('product_media.Media')
      const rows = await ctx.db.all(from(M).where(eq(M.primary, true)).orderBy(asc(M.sequence), asc(M.id)))
      return rows
        .filter(
          (row) =>
            (row.templateId != null && templateIds.has(String(row.templateId))) ||
            (row.productId != null && productIds.has(String(row.productId))),
        )
        .map((row) => ({
          id: row.id,
          attachmentId: row.attachmentId,
          templateId: row.templateId,
          productId: row.productId,
          alt: row.alt,
        }))
    },
  }),

  /** All images for a bounded set of variants, used by the template media tab. */
  listMediaByProducts: defineFn({
    input: { productIds: 'json?' },
    output: mediaOutput,
    effects: ['read:product_media.Media', 'read:storage.Attachment'],
    agent: true,
    handler: async (ctx, args) => {
      const productIds = [...new Set((Array.isArray(args.productIds) ? args.productIds : []).map(String))]
      if (!productIds.length) return []
      const M = ctx.table('product_media.Media')
      return ctx.db.all(
        from(M)
          .where(inArray(M.productId, productIds))
          .orderBy(asc(M.sequence), asc(M.id))
          .preload('attachment'),
      )
    },
  }),

  attachMedia: defineFn({
    input: {
      id: 'id',
      attachmentId: 'id',
      templateId: 'id?',
      productId: 'id?',
      alt: 'text?',
      sequence: 'int?',
      primary: 'bool?',
    },
    output: mediaOutput,
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:storage.Attachment',
      'read:product_media.Media',
      'write:product_media.Media',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const selected = target(args)
      const record = selected.templateId
        ? (await ctx.db.select('product.Template', { id: selected.templateId }))[0]
        : (await ctx.db.select('product.Product', { id: selected.productId }))[0]
      if (!record) invalid('media target does not exist')
      const attachment = (await ctx.db.select('storage.Attachment', { id: args.attachmentId }))[0]
      if (!attachment) invalid('attachment does not exist in the active company')
      if (!String(attachment.mimetype).startsWith('image/')) invalid('product media must be an image')
      const expectedModel = selected.templateId ? 'product.Template' : 'product.Product'
      const expectedId = selected.templateId ?? selected.productId
      if (attachment.resModel !== expectedModel || attachment.resId !== expectedId)
        invalid('attachment target does not match the product media target')

      return ctx.tx(async (tx) => {
        const before = (await tx.db.select('product_media.Media', { id: args.id }))[0]
        if (before && (before.attachmentId !== args.attachmentId || before.targetKey !== selected.targetKey))
          invalid('media id is already attached to another image or target')
        const existing = await rowsFor(tx, selected)
        // The row being written is already in `existing` on a re-run, so both the
        // primary decision and the sequence are taken from the *other* rows.
        // Counting it would make a replay of the first attach see one image, drop
        // makePrimary to false, and demote the only primary the gallery has.
        const others = existing.filter((row) => String(row.id) !== String(args.id))
        const makePrimary =
          args.primary === true || (args.primary == null && before?.primary === true) || others.length === 0
        if (makePrimary) await resetPrimary(tx, existing, args.id)
        const row = {
          id: args.id,
          attachmentId: args.attachmentId,
          templateId: selected.templateId,
          productId: selected.productId,
          targetKey: selected.targetKey,
          primarySlot: makePrimary ? selected.targetKey : null,
          alt: args.alt ?? null,
          sequence: Number(args.sequence ?? before?.sequence ?? others.length * 10 + 10),
          primary: makePrimary,
        }
        const inserted = await tx.db.insertIfAbsent('product_media.Media', row)
        if (!('dryRun' in inserted) && !inserted.inserted)
          await tx.db.update(
            'product_media.Media',
            { id: args.id },
            {
              alt: row.alt,
              sequence: row.sequence,
              primary: row.primary,
              primarySlot: row.primarySlot,
            },
          )
        return { ...row, attachment }
      })
    },
  }),

  setPrimary: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: ['read:product_media.Media', 'read:storage.Attachment', 'write:product_media.Media'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        const row = (await tx.db.select('product_media.Media', { id: args.id }))[0]
        if (!row) invalid('media does not exist')
        const rows = await rowsFor(tx, { templateId: row.templateId, productId: row.productId })
        await resetPrimary(tx, rows, args.id)
        await tx.db.update(
          'product_media.Media',
          { id: args.id },
          { primary: true, primarySlot: row.targetKey },
        )
        return { ok: true }
      }),
  }),

  reorderMedia: defineFn({
    input: { templateId: 'id?', productId: 'id?', ids: 'json' },
    output: { ok: 'bool' },
    effects: ['read:product_media.Media', 'read:storage.Attachment', 'write:product_media.Media'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : invalid('ids must be an array')
      return ctx.tx(async (tx) => {
        const rows = await rowsFor(tx, args)
        const current = new Set(rows.map((row) => String(row.id)))
        if (
          ids.length !== current.size ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !current.has(id))
        )
          invalid('reorder ids must contain every media item exactly once')
        for (let index = 0; index < ids.length; index += 1)
          await tx.db.update('product_media.Media', { id: ids[index] }, { sequence: (index + 1) * 10 })
        return { ok: true }
      })
    },
  }),

  removeMedia: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: [
      'read:product_media.Media',
      'read:storage.Attachment',
      'write:product_media.Media',
      'write:storage.Attachment',
      'enqueue:storage.sweep',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ctx.db.select('product_media.Media', { id: args.id }))[0]
      if (!row) return { ok: true }
      await ctx.tx(async (tx) => {
        const rows = await rowsFor(tx, { templateId: row.templateId, productId: row.productId })
        await tx.db.del(
          deleteFrom(tx.table('product_media.Media')).where(eq(tx.table('product_media.Media').id, args.id)),
        )
        await tx.db.del(
          deleteFrom(tx.table('storage.Attachment')).where(
            eq(tx.table('storage.Attachment').id, row.attachmentId),
          ),
        )
        if (row.primary === true) {
          const next = rows.find((candidate) => candidate.id !== args.id)
          if (next)
            await tx.db.update(
              'product_media.Media',
              { id: next.id },
              { primary: true, primarySlot: next.targetKey },
            )
        }
      })
      await ctx.jobs.enqueue('storage.sweep', { minAgeMs: 0 }, { uniqueKey: `company:${ctx.scope.company}` })
      return { ok: true }
    },
  }),
}
