import { randomUUID } from 'node:crypto'
import { and, asc, defineFn, deleteFrom, eq, from, gt, KetError, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { CONTENT_IMAGE_CATEGORIES } from './types.ts'

type ContentTarget = {
  propertyId: string
  roomTypeId: string | null
  targetKey: string
  resourceType: 'property' | 'room_type'
  resourceId: string
}

type ContentSignal = {
  propertyId: unknown
  resourceType: string
  resourceId: unknown
  kind?: string
  createdAt?: string
}

const imageOutput = {
  id: 'id',
  attachmentId: 'id',
  propertyId: 'id?',
  roomTypeId: 'id?',
  category: 'text',
  caption: 'text?',
  sequence: 'int',
  primary: 'bool',
  createdAt: 'datetime',
  updatedAt: 'datetime',
  attachment: 'json?',
}

const invalid = (message: string): never => {
  throw new KetError({ code: 'E_HOSPITALITY_CONTENT_INVALID', message })
}

const imageCategory = (value: unknown): string => {
  const category = String(value)
  if (!(CONTENT_IMAGE_CATEGORIES as readonly string[]).includes(category))
    invalid('content image category is invalid')
  return category
}

const one = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  (await ctx.db.select(model, { id }))[0] ?? null

const target = async (
  ctx: Ctx,
  args: { propertyId?: unknown; roomTypeId?: unknown },
): Promise<ContentTarget> => {
  const propertyId = args.propertyId == null ? null : String(args.propertyId)
  const roomTypeId = args.roomTypeId == null ? null : String(args.roomTypeId)
  if ((propertyId ? 1 : 0) + (roomTypeId ? 1 : 0) !== 1)
    invalid('content image must belong to exactly one property or room type')
  if (propertyId) {
    if (!(await one(ctx, 'hospitality_core.Property', propertyId))) invalid('property does not exist')
    return {
      propertyId,
      roomTypeId: null,
      targetKey: `property:${propertyId}`,
      resourceType: 'property',
      resourceId: propertyId,
    }
  }
  const selectedRoomTypeId = roomTypeId ?? invalid('room type is required')
  const roomType = await one(ctx, 'hospitality_core.RoomType', selectedRoomTypeId)
  if (!roomType) return invalid('room type does not exist')
  return {
    propertyId: String(roomType.propertyId),
    roomTypeId: selectedRoomTypeId,
    targetKey: `room_type:${selectedRoomTypeId}`,
    resourceType: 'room_type',
    resourceId: selectedRoomTypeId,
  }
}

const targetOfImage = async (ctx: Ctx, image: Row): Promise<ContentTarget> =>
  target(ctx, { propertyId: image.propertyId, roomTypeId: image.roomTypeId })

const rowsFor = async (ctx: Ctx, args: { propertyId?: unknown; roomTypeId?: unknown }): Promise<Row[]> => {
  const selected = await target(ctx, args)
  const Image = ctx.table('hospitality_core.ContentImage')
  const query = selected.roomTypeId
    ? from(Image).where(eq(Image.roomTypeId, selected.roomTypeId))
    : from(Image).where(eq(Image.propertyId, selected.propertyId))
  return ctx.db.all(query.orderBy(asc(Image.sequence), asc(Image.id)).preload('attachment'))
}

const resetPrimary = async (ctx: Ctx, rows: Row[], except?: unknown): Promise<void> => {
  for (const row of rows)
    if (row.primary === true && row.id !== except)
      await ctx.db.update(
        'hospitality_core.ContentImage',
        { id: row.id },
        { primary: false, primarySlot: null, updatedAt: new Date().toISOString() },
      )
}

/** Record a provider-neutral content mutation inside the caller's transaction. */
export const appendContentChange = async (ctx: Ctx, signal: ContentSignal): Promise<Row> => {
  const row = {
    id: randomUUID(),
    propertyId: String(signal.propertyId),
    resourceType: signal.resourceType,
    resourceId: String(signal.resourceId),
    kind: signal.kind ?? 'upsert',
    createdAt: signal.createdAt ?? new Date().toISOString(),
  }
  await ctx.db.insert('hospitality_core.ContentChange', row)
  return row
}

export const content: Record<string, FnSpec> = {
  listContentImages: defineFn({
    input: { propertyId: 'id?', roomTypeId: 'id?' },
    output: imageOutput,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'read:storage.Attachment',
    ],
    agent: true,
    handler: rowsFor,
  }),

  attachContentImage: defineFn({
    input: {
      id: 'id',
      attachmentId: 'id',
      propertyId: 'id?',
      roomTypeId: 'id?',
      category: 'text',
      caption: 'text?',
      sequence: 'int?',
      primary: 'bool?',
    },
    output: imageOutput,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'write:hospitality_core.ContentImage',
      'write:hospitality_core.ContentChange',
      'read:storage.Attachment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const selected = await target(ctx, args)
      const category = imageCategory(args.category)
      const attachment = await one(ctx, 'storage.Attachment', args.attachmentId)
      if (!attachment) return invalid('attachment does not exist in the active company')
      if (!String(attachment.mimetype).startsWith('image/')) invalid('hospitality content must be an image')
      const expectedModel = selected.roomTypeId ? 'hospitality_core.RoomType' : 'hospitality_core.Property'
      if (attachment.resModel !== expectedModel || attachment.resId !== selected.resourceId)
        invalid('attachment target does not match the hospitality content target')

      return ctx.tx(async (tx) => {
        const existing = await rowsFor(tx, args)
        const before = await one(tx, 'hospitality_core.ContentImage', args.id)
        if (before && (before.attachmentId !== args.attachmentId || before.targetKey !== selected.targetKey))
          invalid('content image id is already attached to another image or target')
        const makePrimary = args.primary === true || existing.length === 0 || before?.primary === true
        if (makePrimary) await resetPrimary(tx, existing, args.id)
        const now = new Date().toISOString()
        const sequence = Number(args.sequence ?? before?.sequence ?? existing.length * 10 + 10)
        if (!Number.isInteger(sequence) || sequence < 0) invalid('content image sequence is invalid')
        const row = {
          id: args.id,
          attachmentId: args.attachmentId,
          propertyId: selected.roomTypeId ? null : selected.propertyId,
          roomTypeId: selected.roomTypeId,
          targetKey: selected.targetKey,
          primarySlot: makePrimary ? selected.targetKey : null,
          category,
          caption: args.caption == null ? null : String(args.caption).trim() || null,
          sequence,
          primary: makePrimary,
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        }
        const inserted = await tx.db.insertIfAbsent('hospitality_core.ContentImage', row)
        if (!('dryRun' in inserted) && !inserted.inserted)
          await tx.db.update(
            'hospitality_core.ContentImage',
            { id: args.id },
            {
              category: row.category,
              caption: row.caption,
              sequence: row.sequence,
              primary: row.primary,
              primarySlot: row.primarySlot,
              updatedAt: now,
            },
          )
        await appendContentChange(tx, {
          propertyId: selected.propertyId,
          resourceType: 'image',
          resourceId: args.id,
        })
        return { ...row, attachment }
      })
    },
  }),

  updateContentImage: defineFn({
    input: { id: 'id', category: 'text', caption: 'text?' },
    output: imageOutput,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'write:hospitality_core.ContentImage',
      'write:hospitality_core.ContentChange',
      'read:storage.Attachment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const category = imageCategory(args.category)
      return ctx.tx(async (tx) => {
        const image = await one(tx, 'hospitality_core.ContentImage', args.id)
        if (!image) return invalid('content image does not exist')
        const selected = await targetOfImage(tx, image)
        const updatedAt = new Date().toISOString()
        await tx.db.update(
          'hospitality_core.ContentImage',
          { id: args.id },
          {
            category,
            caption: args.caption == null ? null : String(args.caption).trim() || null,
            updatedAt,
          },
        )
        await appendContentChange(tx, {
          propertyId: selected.propertyId,
          resourceType: 'image',
          resourceId: args.id,
        })
        const attachment = await one(tx, 'storage.Attachment', image.attachmentId)
        return { ...image, category, caption: args.caption ?? null, updatedAt, attachment }
      })
    },
  }),

  setPrimaryContentImage: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'read:storage.Attachment',
      'write:hospitality_core.ContentImage',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const image = await one(tx, 'hospitality_core.ContentImage', args.id)
        if (!image) return invalid('content image does not exist')
        const selected = await targetOfImage(tx, image)
        const rows = await rowsFor(tx, image)
        await resetPrimary(tx, rows, args.id)
        await tx.db.update(
          'hospitality_core.ContentImage',
          { id: args.id },
          { primary: true, primarySlot: selected.targetKey, updatedAt: new Date().toISOString() },
        )
        await appendContentChange(tx, {
          propertyId: selected.propertyId,
          resourceType: 'image',
          resourceId: args.id,
        })
        return { ok: true }
      }),
  }),

  reorderContentImages: defineFn({
    input: { propertyId: 'id?', roomTypeId: 'id?', ids: 'json' },
    output: { ok: 'bool' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'read:storage.Attachment',
      'write:hospitality_core.ContentImage',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : invalid('ids must be an array')
      return ctx.tx(async (tx) => {
        const selected = await target(tx, args)
        const rows = await rowsFor(tx, args)
        const current = new Set(rows.map((row) => String(row.id)))
        if (
          ids.length !== current.size ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !current.has(id))
        )
          invalid('reorder ids must contain every content image exactly once')
        const updatedAt = new Date().toISOString()
        for (let index = 0; index < ids.length; index += 1)
          await tx.db.update(
            'hospitality_core.ContentImage',
            { id: ids[index] },
            { sequence: (index + 1) * 10, updatedAt },
          )
        await appendContentChange(tx, {
          propertyId: selected.propertyId,
          resourceType: selected.resourceType,
          resourceId: selected.resourceId,
          kind: 'reorder',
        })
        return { ok: true }
      })
    },
  }),

  removeContentImage: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImage',
      'read:storage.Attachment',
      'write:hospitality_core.ContentImage',
      'write:hospitality_core.ContentChange',
      'write:storage.Attachment',
      'enqueue:storage.sweep',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const image = await one(ctx, 'hospitality_core.ContentImage', args.id)
      if (!image) return { ok: true }
      await ctx.tx(async (tx) => {
        const selected = await targetOfImage(tx, image)
        const rows = await rowsFor(tx, image)
        const Image = tx.table('hospitality_core.ContentImage')
        const Attachment = tx.table('storage.Attachment')
        await tx.db.del(deleteFrom(Image).where(eq(Image.id, args.id)))
        await tx.db.del(deleteFrom(Attachment).where(eq(Attachment.id, image.attachmentId)))
        if (image.primary === true) {
          const next = rows.find((candidate) => candidate.id !== args.id)
          if (next)
            await tx.db.update(
              'hospitality_core.ContentImage',
              { id: next.id },
              {
                primary: true,
                primarySlot: next.targetKey,
                updatedAt: new Date().toISOString(),
              },
            )
        }
        await appendContentChange(tx, {
          propertyId: selected.propertyId,
          resourceType: 'image',
          resourceId: args.id,
          kind: 'delete',
        })
        await tx.jobs.enqueue('storage.sweep', { minAgeMs: 0 }, { uniqueKey: `company:${tx.scope.company}` })
      })
      return { ok: true }
    },
  }),

  listContentChanges: defineFn({
    input: { propertyId: 'id', afterAt: 'datetime?', afterId: 'id?', limit: 'int?' },
    output: {
      id: 'id',
      propertyId: 'id',
      resourceType: 'text',
      resourceId: 'text',
      kind: 'text',
      createdAt: 'datetime',
    },
    effects: ['read:hospitality_core.ContentChange'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Change = ctx.table('hospitality_core.ContentChange')
      let query = from(Change)
        .where(eq(Change.propertyId, args.propertyId))
        .orderBy(asc(Change.createdAt), asc(Change.id))
      if (args.afterAt && args.afterId)
        query = query.where(
          or(
            gt(Change.createdAt, args.afterAt),
            and(eq(Change.createdAt, args.afterAt), gt(Change.id, args.afterId)),
          ),
        )
      else if (args.afterAt) query = query.where(gt(Change.createdAt, args.afterAt))
      return ctx.db.all(query.limit(Math.max(1, Math.min(500, Number(args.limit ?? 100)))))
    },
  }),
}
