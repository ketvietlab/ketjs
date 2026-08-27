import { createHash } from 'node:crypto'
import { defineFn, eq, from, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as stockFunctions } from '../stock/functions.ts'

type Input = Record<string, unknown>

const now = () => new Date().toISOString()
const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('stock_staff_channel requires an active company')
  return ctx.scope.company
}
const actor = (ctx: Ctx): string => {
  if (!ctx.actor) throw new Error('stock_staff_channel requires a verified actor')
  return ctx.actor
}
const ours = (ctx: Ctx, model: string, where: Input = {}): Promise<Row[]> =>
  ctx.db.select(model, { ...where, companyId: company(ctx) })
const invalid = (field: string, code: string) => ({ ok: false, errors: [{ field, code }] })
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const durableId = (kind: string, ...parts: unknown[]): string =>
  `${kind}_${digest(parts.map(String).join('\n'))}`
const decimal = (value: unknown): boolean => /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(value ?? ''))
const future = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString()
const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

/**
 * Rows by id, asked for by id.
 *
 * The catalogue tables are shared and unbounded, and these paths were reading all
 * of one to keep a handful: every barcode beep pulled the whole product table
 * across to run `.find()` on it in memory, while `barcode` carries a unique index
 * that answers the same question directly.
 */
const byIds = async (ctx: Ctx, model: string, ids: Iterable<unknown>): Promise<Row[]> => {
  const wanted = [...new Set([...ids].filter(Boolean).map(String))]
  if (!wanted.length) return []
  const table = ctx.table(model)
  return ctx.db.all(from(table).where(inArray(table.id, wanted)))
}

const scannedProduct = async (ctx: Ctx, scan: string): Promise<Row | null> => {
  const P = ctx.table('product.Product')
  return (
    (
      await ctx.db.all(
        from(P)
          .where(or(eq(P.barcode, scan), eq(P.defaultCode, scan)))
          .limit(1),
      )
    )[0] ?? null
  )
}

const activeClaim = async (ctx: Ctx, pickingId: unknown): Promise<Row | null> =>
  (await ours(ctx, 'stock_staff_channel.PickingClaim', { activePickingKey: String(pickingId) }))[0] ?? null

const requireOwnedClaim = async (ctx: Ctx, pickingId: unknown): Promise<Row | ReturnType<typeof invalid>> => {
  const claim = await activeClaim(ctx, pickingId)
  if (!claim) return invalid('claim', 'stock_staff_channel.error.activeClaimRequired')
  if (claim.actorUserId !== actor(ctx))
    return invalid('claim', 'stock_staff_channel.error.claimOwnedByAnotherActor')
  return claim
}

const picking = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ours(ctx, 'stock.Picking', { id }))[0] ?? null

const pickingMoves = (ctx: Ctx, id: unknown): Promise<Row[]> => ours(ctx, 'stock.Move', { pickingId: id })

const finishClaim = async (ctx: Ctx, claim: Row, reason: string): Promise<void> => {
  await ctx.db.update(
    'stock_staff_channel.PickingClaim',
    { id: claim.id },
    {
      state: 'released',
      activePickingKey: null,
      releasedByUserId: actor(ctx),
      releaseReason: reason,
      releasedAt: now(),
      version: Number(claim.version) + 1,
    },
  )
}

const executionEffects = [
  'read:stock.Picking',
  'write:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Move',
  'write:stock.Move',
  'read:stock.MoveLine',
  'write:stock.MoveLine',
  'read:stock.Location',
  'read:stock.Warehouse',
  'read:stock.Quant',
  'write:stock.Quant',
  'read:stock.Lot',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock_staff_channel.PickingClaim',
  'write:stock_staff_channel.PickingClaim',
  ...effectsOf(
    stockFunctions.createPicking,
    stockFunctions.addMove,
    stockFunctions.confirmPicking,
    stockFunctions.saveMoveLine,
    stockFunctions.completePicking,
  ),
]

const chooseMove = (moves: Row[], line: Input): Row | null => {
  if (line.moveId) return moves.find((row) => row.id === line.moveId) ?? null
  if (line.productId) {
    const matches = moves.filter((row) => row.productId === line.productId)
    return matches.length === 1 ? matches[0]! : null
  }
  return null
}

const executeLines = async (
  ctx: Ctx,
  heldPicking: Row,
  rawLines: unknown,
): Promise<{ ok: true; lines: Row[]; backorderId: string | null } | ReturnType<typeof invalid>> => {
  if (!Array.isArray(rawLines) || !rawLines.length)
    return invalid('lines', 'stock_staff_channel.error.executionLinesRequired')
  const moves = await pickingMoves(ctx, heldPicking.id)
  const completed: Row[] = []
  const quantities: Array<{ moveLineId: string; quantity: number }> = []
  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index] as Input
    if (!decimal(line.quantity))
      return invalid(`lines.${index}.quantity`, 'stock_staff_channel.error.quantity')
    const move = chooseMove(moves, line)
    if (!move) return invalid(`lines.${index}.moveId`, 'stock_staff_channel.error.executionLine')
    if (line.productId && line.productId !== move.productId)
      return invalid(`lines.${index}.productId`, 'stock_staff_channel.error.executionLine')
    const destinationId = String(line.destinationLocationId ?? move.locationDestId)
    if (destinationId !== String(move.locationDestId))
      return invalid(`lines.${index}.destinationLocationId`, 'stock_staff_channel.error.destination')
    const existing = line.moveLineId
      ? (await ours(ctx, 'stock.MoveLine', { id: line.moveLineId, moveId: move.id }))[0]
      : null
    const sourceId = String(line.sourceLocationId ?? existing?.locationId ?? move.locationId)
    if (sourceId !== String(existing?.locationId ?? move.locationId))
      return invalid(`lines.${index}.sourceLocationId`, 'stock_staff_channel.error.source')
    const moveLineId = existing
      ? String(existing.id)
      : durableId('staff_wml', heldPicking.id, move.id, index, line.lotId ?? '')
    const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
      id: moveLineId,
      moveId: move.id,
      quantity: String(line.quantity),
      lotId: line.lotId ?? undefined,
      picked: true,
    })) as Row
    if (saved.ok !== true) return invalid(`lines.${index}`, 'stock_staff_channel.error.executionLine')
    quantities.push({ moveLineId, quantity: Number(line.quantity) })
    completed.push({
      moveLineId,
      productId: String(move.productId),
      quantity: String(line.quantity),
      sourceLocationId: sourceId,
      destinationLocationId: destinationId,
      ...(line.lotId ? { lotId: String(line.lotId) } : {}),
    })
  }
  const result = (await stockFunctions.completePicking!.handler(ctx, {
    id: heldPicking.id,
    quantities,
    createBackorder: true,
  })) as Row
  if (result.ok !== true) return invalid('pickingId', 'stock_staff_channel.error.executionFailed')
  // Picking less than was asked for leaves a backorder behind, and the caller has
  // to be able to reach it. The id was being dropped here while the execution
  // preview promised `createBackorder: 'always'` and the response said the list
  // was empty — so a partial pick reported itself as a finished one.
  return { ok: true, lines: completed, backorderId: (result.backorderId as string | null) ?? null }
}

export const functions: Record<string, FnSpec> = {
  listActiveClaims: defineFn({
    input: { pickingIds: 'json' },
    effects: ['read:stock_staff_channel.PickingClaim'],
    agent: true,
    handler: async (ctx, args) => {
      const wanted = new Set(Array.isArray(args.pickingIds) ? args.pickingIds.map(String) : [])
      if (!wanted.size) return []
      return (await ours(ctx, 'stock_staff_channel.PickingClaim')).filter(
        (row) => row.state === 'active' && wanted.has(String(row.pickingId)),
      )
    },
  }),

  getScanContext: defineFn({
    input: { sessionId: 'id' },
    effects: [
      'read:stock_staff_channel.ScanSession',
      'read:stock_staff_channel.ScanEvent',
      'read:stock.Picking',
      'read:stock.PickingType',
      'read:stock.Warehouse',
      'read:stock.Move',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ours(ctx, 'stock_staff_channel.ScanSession', { id: args.sessionId }))[0]
      if (!session || session.actorUserId !== actor(ctx)) return null
      const heldPicking = await picking(ctx, session.pickingId)
      if (!heldPicking) return null
      const type = (await ours(ctx, 'stock.PickingType', { id: heldPicking.pickingTypeId }))[0] ?? null
      const warehouse = type?.warehouseId
        ? ((await ours(ctx, 'stock.Warehouse', { id: type.warehouseId }))[0] ?? null)
        : null
      const moves = await pickingMoves(ctx, heldPicking.id)
      const products = await byIds(
        ctx,
        'product.Product',
        moves.map((row) => row.productId),
      )
      const templates = await byIds(
        ctx,
        'product.Template',
        products.map((row) => row.templateId),
      )
      const units = await byIds(
        ctx,
        'uom.Unit',
        moves.map((row) => row.productUomId),
      )
      return {
        session,
        picking: heldPicking,
        type,
        warehouse,
        moves,
        events: await ours(ctx, 'stock_staff_channel.ScanEvent', { sessionId: session.id }),
        products,
        templates,
        units,
      }
    },
  }),

  listCountSessions: defineFn({
    input: { limit: 'int?', offset: 'int?' },
    effects: ['read:stock_staff_channel.CountSession'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'stock_staff_channel.CountSession'))
        .filter((row) => ['ready', 'in_progress'].includes(String(row.state)))
        .sort(
          (left, right) =>
            String(right.cutoffAt).localeCompare(String(left.cutoffAt)) ||
            String(right.id).localeCompare(String(left.id)),
        )
        .slice(
          Math.max(0, Number(args.offset ?? 0)),
          Math.max(0, Number(args.offset ?? 0)) + Math.max(1, Number(args.limit ?? 20)),
        ),
  }),

  getCountContext: defineFn({
    input: { sessionId: 'id?', attemptId: 'id?', lineId: 'id?' },
    effects: [
      'read:stock_staff_channel.CountSession',
      'read:stock_staff_channel.CountAttempt',
      'read:stock_staff_channel.CountLine',
      'read:stock.Warehouse',
      'read:stock.Location',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      let line = args.lineId
        ? ((await ours(ctx, 'stock_staff_channel.CountLine', { id: args.lineId }))[0] ?? null)
        : null
      let attempt = args.attemptId
        ? ((await ours(ctx, 'stock_staff_channel.CountAttempt', { id: args.attemptId }))[0] ?? null)
        : null
      if (!attempt && line)
        attempt = (await ours(ctx, 'stock_staff_channel.CountAttempt', { id: line.attemptId }))[0] ?? null
      let session = args.sessionId
        ? ((await ours(ctx, 'stock_staff_channel.CountSession', { id: args.sessionId }))[0] ?? null)
        : null
      if (!session && attempt)
        session = (await ours(ctx, 'stock_staff_channel.CountSession', { id: attempt.sessionId }))[0] ?? null
      if (!session) return null
      const ownAttempt =
        attempt?.actorUserId === actor(ctx)
          ? attempt
          : ((
              await ours(ctx, 'stock_staff_channel.CountAttempt', {
                sessionId: session.id,
                actorUserId: actor(ctx),
              })
            )[0] ?? null)
      if (line && ownAttempt?.id !== line.attemptId) line = null
      const lines = ownAttempt
        ? await ours(ctx, 'stock_staff_channel.CountLine', { attemptId: ownAttempt.id })
        : []
      const warehouse = (await ours(ctx, 'stock.Warehouse', { id: session.warehouseId }))[0] ?? null
      const location = (await ours(ctx, 'stock.Location', { id: session.locationId }))[0] ?? null
      const product = (await ctx.db.select('product.Product', { id: session.productId }))[0] ?? null
      const template = product
        ? ((await ctx.db.select('product.Template', { id: product.templateId }))[0] ?? null)
        : null
      const units = await byIds(
        ctx,
        'uom.Unit',
        lines.map((row) => row.productUomId),
      )
      const lots = await byIds(
        ctx,
        'stock.Lot',
        lines.map((row) => row.lotId),
      )
      return {
        session,
        attempt: ownAttempt,
        line,
        lines,
        warehouse,
        location,
        product,
        template,
        units,
        lots,
      }
    },
  }),

  /**
   * Claiming a transfer, and claiming it again with the same key.
   *
   * The id used to carry `Date.now()`, so a retry built a different row and the
   * active-claim guard rejected it: replaying one POST with the same
   * `Idempotency-Key` answered 409 `claimed` — the caller told it was beaten to
   * its own claim. On a handheld in a warehouse a dropped response is the normal
   * case, so the retry path has to be the working path. The caller supplies the
   * id now, derived from the command it is retrying, and a claim that already
   * carries that id is the same claim coming back.
   */
  claimPicking: defineFn({
    input: { id: 'id', pickingId: 'id', reason: 'text' },
    output: { ok: 'bool', claimId: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Picking',
      'read:stock_staff_channel.PickingClaim',
      'write:stock_staff_channel.PickingClaim',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = await picking(ctx, args.pickingId)
      if (!held) return invalid('pickingId', 'stock_staff_channel.error.pickingNotFound')
      const reason = String(args.reason ?? '').trim()
      if (reason.length < 3 || reason.length > 500)
        return invalid('reason', 'stock_staff_channel.error.reason')
      const id = String(args.id)
      const replay = (await ours(ctx, 'stock_staff_channel.PickingClaim', { id }))[0]
      if (replay) return { ok: true, claimId: String(replay.id) }
      if (await activeClaim(ctx, held.id)) return invalid('pickingId', 'stock_staff_channel.error.claimed')
      if (!['assigned', 'partially_available', 'confirmed', 'done'].includes(String(held.state)))
        return invalid('pickingId', 'stock_staff_channel.error.claimState')
      await ctx.db.insert('stock_staff_channel.PickingClaim', {
        id,
        pickingId: held.id,
        actorUserId: actor(ctx),
        state: 'active',
        activePickingKey: String(held.id),
        claimReason: reason,
        claimedAt: now(),
        releasedByUserId: null,
        releaseReason: null,
        releasedAt: null,
        version: 1,
      })
      return { ok: true, claimId: id }
    },
  }),

  releasePicking: defineFn({
    input: { pickingId: 'id', reason: 'text' },
    output: { ok: 'bool', claimId: 'id?', errors: 'json?' },
    effects: ['read:stock_staff_channel.PickingClaim', 'write:stock_staff_channel.PickingClaim'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const reason = String(args.reason ?? '').trim()
      if (reason.length < 3 || reason.length > 500)
        return invalid('reason', 'stock_staff_channel.error.reason')
      const claim = await requireOwnedClaim(ctx, args.pickingId)
      if ('ok' in claim) return claim
      await finishClaim(ctx, claim, reason)
      return { ok: true, claimId: claim.id }
    },
  }),

  completeGuidedPicking: defineFn({
    input: { pickingId: 'id', lines: 'json', reason: 'text' },
    output: { ok: 'bool', claimId: 'id?', backorderId: 'id?', completedAt: 'datetime?', errors: 'json?' },
    effects: executionEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = await picking(ctx, args.pickingId)
      if (!held) return invalid('pickingId', 'stock_staff_channel.error.pickingNotFound')
      const claim = await requireOwnedClaim(ctx, held.id)
      if ('ok' in claim) return claim
      const lines = Array.isArray(args.lines) ? (args.lines as Input[]) : []
      const moves = await pickingMoves(ctx, held.id)
      if (lines.length !== moves.length)
        return invalid('lines', 'stock_staff_channel.error.executionIncomplete')
      const products = await byIds(
        ctx,
        'product.Product',
        moves.map((row) => row.productId),
      )
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        const move = moves.find((row) => String(row.id) === String(line.lineId))
        const product = move ? products.find((row) => row.id === move.productId) : null
        if (!move || !product || String(product.barcode ?? '') !== String(line.barcode ?? ''))
          return invalid(`lines.${index}.barcode`, 'stock_staff_channel.error.barcode')
        if (Number(line.quantity) !== Number(move.productUomQty))
          return invalid(`lines.${index}.quantity`, 'stock_staff_channel.error.quantity')
      }
      const executed = await executeLines(
        ctx,
        held,
        lines.map((line) => ({
          moveId: line.lineId,
          productId: moves.find((row) => String(row.id) === String(line.lineId))?.productId,
          quantity: line.quantity,
          destinationLocationId: held.locationDestId,
        })),
      )
      if ('errors' in executed) return executed
      await finishClaim(ctx, claim, String(args.reason))
      const refreshed = await picking(ctx, held.id)
      return {
        ok: true,
        claimId: claim.id,
        completedAt: refreshed?.dateDone ?? now(),
        backorderId: executed.backorderId,
      }
    },
  }),

  completeExecution: defineFn({
    input: { pickingId: 'id', lines: 'json' },
    output: { ok: 'bool', lines: 'json?', backorderIds: 'json?', errors: 'json?' },
    effects: executionEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = await picking(ctx, args.pickingId)
      if (!held) return invalid('pickingId', 'stock_staff_channel.error.pickingNotFound')
      const claim = await requireOwnedClaim(ctx, held.id)
      if ('ok' in claim) return claim
      const executed = await executeLines(ctx, held, args.lines)
      if ('errors' in executed) return executed
      await finishClaim(ctx, claim, 'Canonical warehouse execution completed')
      return {
        ok: true,
        lines: executed.lines,
        backorderIds: executed.backorderId ? [executed.backorderId] : [],
      }
    },
  }),

  completeReturnExecution: defineFn({
    input: { sourcePickingId: 'id', lines: 'json', returnPickingId: 'id' },
    output: { ok: 'bool', returnPickingId: 'id?', lines: 'json?', errors: 'json?' },
    effects: executionEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const source = await picking(ctx, args.sourcePickingId)
      if (source?.state !== 'done')
        return invalid('sourcePickingId', 'stock_staff_channel.error.returnSource')
      const claim = await requireOwnedClaim(ctx, source.id)
      if ('ok' in claim) return claim
      if (!Array.isArray(args.lines) || !args.lines.length)
        return invalid('lines', 'stock_staff_channel.error.executionLinesRequired')
      const sourceType = (await ours(ctx, 'stock.PickingType', { id: source.pickingTypeId }))[0]
      const types = await ours(ctx, 'stock.PickingType', { warehouseId: sourceType?.warehouseId })
      const reverseCode =
        sourceType?.code === 'outgoing'
          ? 'incoming'
          : sourceType?.code === 'incoming'
            ? 'outgoing'
            : 'internal'
      const reverseType = types.find((row) => row.code === reverseCode) ?? sourceType
      if (!reverseType) return invalid('sourcePickingId', 'stock_staff_channel.error.returnType')
      const created = (await stockFunctions.createPicking!.handler(ctx, {
        id: args.returnPickingId,
        name: `${String(source.name)} RETURN`,
        pickingTypeId: reverseType.id,
        locationId: source.locationDestId,
        locationDestId: source.locationId,
        moveType: 'direct',
        scheduledDate: now(),
      })) as Row
      if (created.ok !== true) return invalid('returnPickingId', 'stock_staff_channel.error.executionFailed')
      const completed: Row[] = []
      for (let index = 0; index < args.lines.length; index++) {
        const line = args.lines[index] as Input
        if (!decimal(line.quantity))
          return invalid(`lines.${index}.quantity`, 'stock_staff_channel.error.quantity')
        if (
          String(line.sourceLocationId) !== String(source.locationDestId) ||
          String(line.destinationLocationId) !== String(source.locationId)
        )
          return invalid(`lines.${index}.sourceLocationId`, 'stock_staff_channel.error.source')
        const moveId = durableId('staff_wret_move', args.returnPickingId, index)
        const added = (await stockFunctions.addMove!.handler(ctx, {
          id: moveId,
          name: `Return ${String(line.productId)}`,
          pickingId: args.returnPickingId,
          productId: line.productId,
          productUomId:
            (await ours(ctx, 'stock.MoveLine', { id: line.sourceMoveLineId }))[0]?.productUomId ??
            (await pickingMoves(ctx, source.id)).find((row) => row.productId === line.productId)
              ?.productUomId,
          productUomQty: String(line.quantity),
          locationId: source.locationDestId,
          locationDestId: source.locationId,
        })) as Row
        if (added.ok !== true) return invalid(`lines.${index}`, 'stock_staff_channel.error.executionLine')
        completed.push({
          moveLineId: durableId('staff_wret_line', args.returnPickingId, index),
          sourceMoveLineId: String(line.sourceMoveLineId),
          productId: String(line.productId),
          quantity: String(line.quantity),
          sourceLocationId: String(source.locationDestId),
          destinationLocationId: String(source.locationId),
        })
      }
      await stockFunctions.confirmPicking!.handler(ctx, { id: args.returnPickingId })
      const executed = await executeLines(ctx, (await picking(ctx, args.returnPickingId))!, completed)
      if ('errors' in executed) return executed
      await finishClaim(ctx, claim, 'Return execution completed')
      return { ok: true, returnPickingId: args.returnPickingId, lines: executed.lines }
    },
  }),

  startScanSession: defineFn({
    input: { id: 'id', pickingId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Picking',
      'read:stock_staff_channel.PickingClaim',
      'read:stock_staff_channel.ScanSession',
      'write:stock_staff_channel.ScanSession',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await picking(ctx, args.pickingId)))
        return invalid('pickingId', 'stock_staff_channel.error.pickingNotFound')
      const claim = await requireOwnedClaim(ctx, args.pickingId)
      if ('ok' in claim) return claim
      const existing = (await ours(ctx, 'stock_staff_channel.ScanSession', { id: args.id }))[0]
      if (existing) return { ok: true, id: existing.id }
      const timestamp = now()
      await ctx.db.insert('stock_staff_channel.ScanSession', {
        id: args.id,
        pickingId: args.pickingId,
        actorUserId: actor(ctx),
        state: 'active',
        version: 1,
        startedAt: timestamp,
        updatedAt: timestamp,
        expiresAt: future(120),
        feedbackKind: null,
        feedbackReason: null,
        feedbackAnnounce: null,
      })
      return { ok: true, id: args.id }
    },
  }),

  submitScanEvent: defineFn({
    input: { sessionId: 'id', expectedVersion: 'int', scan: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock_staff_channel.ScanSession',
      'write:stock_staff_channel.ScanSession',
      'read:stock_staff_channel.ScanEvent',
      'write:stock_staff_channel.ScanEvent',
      'read:stock.Move',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ours(ctx, 'stock_staff_channel.ScanSession', { id: args.sessionId }))[0]
      if (!session || session.actorUserId !== actor(ctx))
        return invalid('sessionId', 'stock_staff_channel.error.scanSession')
      if (session.state !== 'active') return invalid('state', 'stock_staff_channel.error.scanState')
      if (Number(session.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      const replay = (
        await ours(ctx, 'stock_staff_channel.ScanEvent', {
          sessionId: session.id,
          idempotencyKey: args.idempotencyKey,
        })
      )[0]
      if (replay) return { ok: true, id: replay.id }
      const scan = String(args.scan).trim()
      const product = await scannedProduct(ctx, scan)
      const moves = await pickingMoves(ctx, session.pickingId)
      const move = product ? moves.find((row) => row.productId === product.id) : null
      if (!product || !move) {
        await ctx.db.update(
          'stock_staff_channel.ScanSession',
          { id: session.id },
          {
            version: Number(session.version) + 1,
            updatedAt: now(),
            feedbackKind: 'error',
            feedbackReason: 'PRODUCT_NOT_EXPECTED',
            feedbackAnnounce: 'Scanned product is not expected on this transfer.',
          },
        )
        // A rejected barcode is still a successfully recorded scan outcome. The
        // caller needs the advanced session version and feedback to recover; a
        // 422 here would strand it on the stale version we just invalidated.
        return { ok: true }
      }
      const id = durableId('staff_wscan_event', session.id, args.idempotencyKey)
      await ctx.tx(async (tx) => {
        await tx.db.insert('stock_staff_channel.ScanEvent', {
          id,
          sessionId: session.id,
          actorUserId: actor(ctx),
          moveId: move.id,
          productId: product.id,
          barcodeFingerprint: digest(scan),
          quantity: '1',
          occurredAt: now(),
          idempotencyKey: args.idempotencyKey,
          sessionVersion: Number(session.version) + 1,
        })
        await tx.db.update(
          'stock_staff_channel.ScanSession',
          { id: session.id },
          {
            version: Number(session.version) + 1,
            updatedAt: now(),
            feedbackKind: 'success',
            feedbackReason: 'PRODUCT_SCANNED',
            feedbackAnnounce: 'Product scan accepted.',
          },
        )
      })
      return { ok: true, id }
    },
  }),

  transitionScanSession: defineFn({
    input: { sessionId: 'id', expectedVersion: 'int', targetState: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock_staff_channel.ScanSession', 'write:stock_staff_channel.ScanSession'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ours(ctx, 'stock_staff_channel.ScanSession', { id: args.sessionId }))[0]
      if (!session || session.actorUserId !== actor(ctx))
        return invalid('sessionId', 'stock_staff_channel.error.scanSession')
      if (Number(session.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      if (!['active', 'paused', 'cancelled'].includes(String(args.targetState)))
        return invalid('targetState', 'stock_staff_channel.error.scanState')
      await ctx.db.update(
        'stock_staff_channel.ScanSession',
        { id: session.id },
        {
          state: args.targetState,
          version: Number(session.version) + 1,
          updatedAt: now(),
          feedbackKind: 'neutral',
          feedbackReason: `SESSION_${String(args.targetState).toUpperCase()}`,
          feedbackAnnounce: `Scan session ${String(args.targetState)}.`,
        },
      )
      return { ok: true, id: session.id }
    },
  }),

  createCountSession: defineFn({
    input: {
      id: 'id',
      warehouseId: 'id',
      locationId: 'id',
      productId: 'id',
      mode: 'text',
      requiredAttemptCount: 'int?',
      cutoffAt: 'datetime?',
      expiresAt: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Warehouse',
      'read:stock.Location',
      'read:product.Product',
      'read:stock_staff_channel.CountSession',
      'write:stock_staff_channel.CountSession',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['guided', 'blind', 'double_blind'].includes(String(args.mode)))
        return invalid('mode', 'stock_staff_channel.error.countMode')
      if (!(await ours(ctx, 'stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'stock_staff_channel.error.countScope')
      if (!(await ours(ctx, 'stock.Location', { id: args.locationId }))[0])
        return invalid('locationId', 'stock_staff_channel.error.countScope')
      if (!(await ctx.db.select('product.Product', { id: args.productId }))[0])
        return invalid('productId', 'stock_staff_channel.error.countScope')
      await ctx.db.insertIfAbsent('stock_staff_channel.CountSession', {
        id: args.id,
        warehouseId: args.warehouseId,
        locationId: args.locationId,
        productId: args.productId,
        mode: args.mode,
        state: 'ready',
        requiredAttemptCount: Math.max(1, Number(args.requiredAttemptCount ?? 1)),
        completedAttemptCount: 0,
        cutoffAt: args.cutoffAt ?? now(),
        expiresAt: args.expiresAt ?? future(24 * 60),
        version: 1,
      })
      return { ok: true, id: args.id }
    },
  }),

  claimCountSession: defineFn({
    input: { sessionId: 'id', expectedVersion: 'int', attemptId: 'id', deviceRef: 'text?' },
    output: { ok: 'bool', attemptId: 'id?', errors: 'json?' },
    effects: [
      'read:stock_staff_channel.CountSession',
      'write:stock_staff_channel.CountSession',
      'read:stock_staff_channel.CountAttempt',
      'write:stock_staff_channel.CountAttempt',
      'write:stock_staff_channel.CountLine',
      'read:stock.Quant',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const session = (await ours(ctx, 'stock_staff_channel.CountSession', { id: args.sessionId }))[0]
      if (!session) return invalid('sessionId', 'stock_staff_channel.error.countSession')
      if (Number(session.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      if (!['ready', 'in_progress'].includes(String(session.state)))
        return invalid('state', 'stock_staff_channel.error.countState')
      const existing = (
        await ours(ctx, 'stock_staff_channel.CountAttempt', {
          sessionId: session.id,
          actorUserId: actor(ctx),
        })
      )[0]
      if (existing) return { ok: true, attemptId: existing.id }
      const product = (await ctx.db.select('product.Product', { id: session.productId }))[0]
      const template = product
        ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        : null
      if (!product || !template?.uomId) return invalid('productId', 'stock_staff_channel.error.countScope')
      const quants = (
        await ours(ctx, 'stock.Quant', {
          productId: session.productId,
          locationId: session.locationId,
        })
      ).sort((left, right) => String(left.id).localeCompare(String(right.id)))
      const positions = quants.length ? quants : [{ id: 'empty', lotId: null, quantity: '0' }]
      await ctx.tx(async (tx) => {
        await tx.db.insert('stock_staff_channel.CountAttempt', {
          id: args.attemptId,
          sessionId: session.id,
          actorUserId: actor(ctx),
          state: 'claimed',
          deviceRef: args.deviceRef ?? null,
          leaseExpiresAt: future(15),
          submittedAt: null,
          version: 1,
        })
        for (let index = 0; index < positions.length; index++) {
          const quant = positions[index]!
          await tx.db.insert('stock_staff_channel.CountLine', {
            id: durableId('staff_wcount_line', args.attemptId, quant.id, index),
            attemptId: args.attemptId,
            productId: session.productId,
            locationId: session.locationId,
            lotId: quant.lotId ?? null,
            productUomId: template.uomId,
            systemQuantity: String(quant.quantity ?? 0),
            isCounted: false,
            countedQuantity: null,
            version: 1,
          })
        }
        await tx.db.update(
          'stock_staff_channel.CountSession',
          { id: session.id },
          { state: 'in_progress', version: Number(session.version) + 1 },
        )
      })
      return { ok: true, attemptId: args.attemptId }
    },
  }),

  resumeCountAttempt: defineFn({
    input: { attemptId: 'id', expectedVersion: 'int', deviceRef: 'text?' },
    output: { ok: 'bool', attemptId: 'id?', errors: 'json?' },
    effects: ['read:stock_staff_channel.CountAttempt', 'write:stock_staff_channel.CountAttempt'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const attempt = (await ours(ctx, 'stock_staff_channel.CountAttempt', { id: args.attemptId }))[0]
      if (!attempt || attempt.actorUserId !== actor(ctx))
        return invalid('attemptId', 'stock_staff_channel.error.countAttempt')
      if (Number(attempt.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      if (attempt.state === 'submitted') return invalid('state', 'stock_staff_channel.error.countState')
      await ctx.db.update(
        'stock_staff_channel.CountAttempt',
        { id: attempt.id },
        {
          state: 'in_progress',
          deviceRef: args.deviceRef ?? attempt.deviceRef,
          leaseExpiresAt: future(15),
          version: Number(attempt.version) + 1,
        },
      )
      return { ok: true, attemptId: attempt.id }
    },
  }),

  recordCountLine: defineFn({
    input: { lineId: 'id', expectedVersion: 'int', quantity: 'decimal' },
    output: { ok: 'bool', lineId: 'id?', errors: 'json?' },
    effects: [
      'read:stock_staff_channel.CountLine',
      'write:stock_staff_channel.CountLine',
      'read:stock_staff_channel.CountAttempt',
      'write:stock_staff_channel.CountAttempt',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ours(ctx, 'stock_staff_channel.CountLine', { id: args.lineId }))[0]
      if (!line) return invalid('lineId', 'stock_staff_channel.error.countLine')
      const attempt = (await ours(ctx, 'stock_staff_channel.CountAttempt', { id: line.attemptId }))[0]
      if (!attempt || attempt.actorUserId !== actor(ctx) || attempt.state === 'submitted')
        return invalid('lineId', 'stock_staff_channel.error.countAttempt')
      if (Number(line.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      if (!decimal(args.quantity)) return invalid('quantity', 'stock_staff_channel.error.quantity')
      await ctx.tx(async (tx) => {
        await tx.db.update(
          'stock_staff_channel.CountLine',
          { id: line.id },
          { isCounted: true, countedQuantity: String(args.quantity), version: Number(line.version) + 1 },
        )
        await tx.db.update(
          'stock_staff_channel.CountAttempt',
          { id: attempt.id },
          { state: 'in_progress', leaseExpiresAt: future(15), version: Number(attempt.version) + 1 },
        )
      })
      return { ok: true, lineId: line.id }
    },
  }),

  submitCountAttempt: defineFn({
    input: { attemptId: 'id', expectedVersion: 'int' },
    output: { ok: 'bool', attemptId: 'id?', errors: 'json?' },
    effects: [
      'read:stock_staff_channel.CountAttempt',
      'write:stock_staff_channel.CountAttempt',
      'read:stock_staff_channel.CountLine',
      'read:stock_staff_channel.CountSession',
      'write:stock_staff_channel.CountSession',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const attempt = (await ours(ctx, 'stock_staff_channel.CountAttempt', { id: args.attemptId }))[0]
      if (!attempt || attempt.actorUserId !== actor(ctx))
        return invalid('attemptId', 'stock_staff_channel.error.countAttempt')
      if (Number(attempt.version) !== Number(args.expectedVersion))
        return invalid('expectedVersion', 'stock_staff_channel.error.versionConflict')
      const lines = await ours(ctx, 'stock_staff_channel.CountLine', { attemptId: attempt.id })
      if (!lines.length || lines.some((line) => line.isCounted !== true))
        return invalid('lines', 'stock_staff_channel.error.countIncomplete')
      const session = (await ours(ctx, 'stock_staff_channel.CountSession', { id: attempt.sessionId }))[0]!
      const completed = Number(session.completedAttemptCount) + 1
      const state = completed >= Number(session.requiredAttemptCount) ? 'review_ready' : 'in_progress'
      await ctx.tx(async (tx) => {
        await tx.db.update(
          'stock_staff_channel.CountAttempt',
          { id: attempt.id },
          {
            state: 'submitted',
            submittedAt: now(),
            leaseExpiresAt: null,
            version: Number(attempt.version) + 1,
          },
        )
        await tx.db.update(
          'stock_staff_channel.CountSession',
          { id: session.id },
          {
            state,
            completedAttemptCount: completed,
            version: Number(session.version) + 1,
          },
        )
      })
      return { ok: true, attemptId: attempt.id }
    },
  }),
}
