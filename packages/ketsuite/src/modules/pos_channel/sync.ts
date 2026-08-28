import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, ModelDef, Route, Row, ServeContext } from '@ketvietlab/ketjs'
import {
  channelCommandId,
  channelError,
  defineChannelRoute,
  routesOf,
  stableHash,
  type PosIdentity,
} from '../channel_api/core.ts'
import {
  commandOptions as posCommandOptions,
  posCommandKey,
  posLifecycleFunction,
  posOrderFor,
  posOrderSchema,
  posProjectOrder,
  posProjectShift,
  posShiftSchema,
  posShiftFor,
} from './operations.ts'
import {
  posOfflineCommandDigest,
  posOfflineLeaseProvider,
  type PosOfflineCommandEvidence,
  type PosOfflineLeaseClaims,
} from './offline.ts'

type Req = Parameters<Route>[1]
type OfflineCommand = Omit<PosOfflineCommandEvidence, 'operation'> & {
  commandId: string
  sequence: number
  dependencyIds: string[]
  aggregateType: 'order'
  aggregateId: string
  aggregateRevision: number
  operation: OfflineOperation
  capturedAt: string
  idempotencyKey: string
}

const MAX_BATCH_SIZE = 50
const MAX_DEPENDENCIES = 20
const OUTBOX_GRACE_MS = 72 * 60 * 60 * 1_000
const COMMAND_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const LEASE_MS = 30 * 1_000
const FUTURE_SKEW_MS = 5 * 60 * 1_000

export const OFFLINE_OPERATIONS = [
  'pos.orders.create',
  'pos.orders.update',
  'pos.orders.lines.add',
  'pos.orders.lines.update',
  'pos.orders.lines.lots.select',
  'pos.orders.lines.remove',
  'pos.orders.lines.reorder',
  'pos.orders.tenders.add',
  'pos.orders.tenders.void',
  'pos.orders.finalize',
  'pos.orders.cancel',
] as const

type OfflineOperation = (typeof OFFLINE_OPERATIONS)[number]

const ONLINE_ONLY_OPERATIONS = [
  'pos.shifts.create',
  'pos.shifts.close',
  'pos.shifts.variance.recount',
  'pos.shifts.variance.approve',
  'pos.orders.lines.discount',
  'pos.orders.lines.priceOverride',
  'pos.orders.paymentAttempts.create',
  'pos.orders.paymentAttempts.get',
  'pos.orders.returns.create',
  'pos.orders.exchanges.create',
] as const

const policy = {
  protocolVersion: '1.0',
  maxBatchSize: MAX_BATCH_SIZE,
  maxDependenciesPerCommand: MAX_DEPENDENCIES,
  outboxUploadGraceHours: OUTBOX_GRACE_MS / 3_600_000,
  commandRetentionDays: COMMAND_RETENTION_MS / 86_400_000,
  requiresSignedLease: true,
  requiresDeviceSignature: true,
  offlineOperationIds: OFFLINE_OPERATIONS,
  onlineOnlyOperationIds: ONLINE_ONLY_OPERATIONS,
  conflictPolicy: {
    price: 'reload_catalog_and_rebase_draft',
    tax: 'reload_catalog_and_rebase_draft',
    stock: 'reload_aggregate_or_manual_reconciliation',
    loyalty: 'reload_aggregate_or_manual_reconciliation',
    paymentProvider: 'online_only',
  },
} as const

const string = { type: 'string', minLength: 1, maxLength: 512 }
const commandId = { type: 'string', minLength: 8, maxLength: 200 }
const integer = { type: 'integer', minimum: 0 }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const nullableString = { type: ['string', 'null'] }
const revisionVectorSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    config: string,
    catalog: string,
    price: string,
    tax: string,
    paymentMethods: string,
    capabilities: string,
    master: string,
    shift: nullableString,
  },
  required: ['config', 'catalog', 'price', 'tax', 'paymentMethods', 'capabilities', 'master', 'shift'],
}
const leaseClaimsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leaseId: string,
    companyId: string,
    posConfigId: string,
    deviceId: string,
    grantId: string,
    operatorId: string,
    sessionId: string,
    deviceSecurityVersion: integer,
    grantSecurityVersion: integer,
    shiftId: string,
    priceBookRevision: string,
    issuedAt: string,
    expiresAt: string,
    minSequence: { type: 'integer', minimum: 1 },
    maxSequence: { type: 'integer', minimum: 1 },
    allowedOperationIds: { type: 'array', items: { type: 'string', enum: [...OFFLINE_OPERATIONS] } },
    ceilings: { type: 'object' },
  },
  required: [
    'leaseId',
    'companyId',
    'posConfigId',
    'deviceId',
    'grantId',
    'operatorId',
    'sessionId',
    'deviceSecurityVersion',
    'grantSecurityVersion',
    'shiftId',
    'priceBookRevision',
    'issuedAt',
    'expiresAt',
    'minSequence',
    'maxSequence',
    'allowedOperationIds',
    'ceilings',
  ],
}
const offlineLeaseSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: { token: string, claims: leaseClaimsSchema },
  required: ['token', 'claims'],
}
const paymentMethodSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    isCashCount: { type: 'boolean' },
    type: { type: 'string', enum: ['cash', 'bank'] },
  },
  required: ['id', 'name', 'isCashCount', 'type'],
}
const syncPolicySchema = {
  type: 'object',
  properties: {
    protocolVersion: string,
    maxBatchSize: integer,
    maxDependenciesPerCommand: integer,
    outboxUploadGraceHours: integer,
    commandRetentionDays: integer,
    requiresSignedLease: { type: 'boolean' },
    requiresDeviceSignature: { type: 'boolean' },
    offlineEnabled: { type: 'boolean' },
    offlineOperationIds: { type: 'array', items: string },
    onlineOnlyOperationIds: { type: 'array', items: string },
    conflictPolicy: { type: 'object' },
  },
  required: [
    'protocolVersion',
    'maxBatchSize',
    'maxDependenciesPerCommand',
    'outboxUploadGraceHours',
    'commandRetentionDays',
    'requiresSignedLease',
    'requiresDeviceSignature',
    'offlineEnabled',
    'offlineOperationIds',
    'onlineOnlyOperationIds',
    'conflictPolicy',
  ],
}
const bootstrapSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    protocolVersion: string,
    companyId: string,
    posConfigId: string,
    deviceId: string,
    revisions: revisionVectorSchema,
    shift: { ...posShiftSchema, type: ['object', 'null'] },
    paymentMethods: { type: 'array', items: paymentMethodSchema },
    policy: syncPolicySchema,
    offlineLease: offlineLeaseSchema,
    resumeCursor: nullableString,
  },
  required: [
    'protocolVersion',
    'companyId',
    'posConfigId',
    'deviceId',
    'revisions',
    'shift',
    'paymentMethods',
    'policy',
    'offlineLease',
    'resumeCursor',
  ],
}
const syncResultSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['accepted', 'replayed', 'conflict', 'refused'] },
    originalStatus: { type: 'string', enum: ['accepted', 'conflict', 'refused'] },
    commandId: string,
    operation: { type: 'string', enum: [...OFFLINE_OPERATIONS] },
    code: string,
    retryable: { type: 'boolean' },
    entityId: string,
    aggregateId: string,
    aggregateRevision: integer,
    projection: posOrderSchema,
    serverProjection: { ...posOrderSchema, type: ['object', 'null'] },
    allowedRecovery: { type: 'array', items: string },
    issues: { type: 'array', items: string },
  },
  required: ['status', 'commandId'],
}
const reconcileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    batchId: string,
    accepted: integer,
    replayed: integer,
    conflicted: integer,
    refused: integer,
    results: { type: 'array', items: syncResultSchema },
    retentionUntil: string,
  },
  required: ['batchId', 'accepted', 'replayed', 'conflicted', 'refused', 'results', 'retentionUntil'],
}

export const syncModels: Record<string, ModelDef> = {
  SyncCommand: {
    scope: 'company',
    fields: {
      id: 'id',
      commandId: 'text',
      deviceId: 'text',
      configId: 'ref:pos.Config',
      operatorId: 'text',
      sequence: 'int',
      operation: 'text',
      aggregateType: 'text',
      aggregateId: 'text',
      aggregateRevision: 'int',
      dependencyIds: 'json',
      capturedAt: 'datetime',
      idempotencyKey: 'text',
      requestHash: 'text',
      request: 'json',
      state: 'text',
      result: 'json?',
      attempts: 'int',
      leaseToken: 'text',
      leaseUntil: 'datetime',
      createdAt: 'datetime',
      completedAt: 'datetime?',
      expiresAt: 'datetime',
    },
    indexes: {
      command: { fields: ['companyId', 'commandId'], unique: true },
      device_sequence: { fields: ['companyId', 'deviceId', 'sequence'], unique: true },
      device_idempotency: {
        fields: ['companyId', 'deviceId', 'operation', 'idempotencyKey'],
        unique: true,
      },
      expiry: { fields: ['companyId', 'expiresAt'] },
    },
  },
}

const sameClaim = (row: Row, args: Row): boolean =>
  String(row.deviceId) === String(args.deviceId) &&
  String(row.configId) === String(args.configId) &&
  String(row.operatorId) === String(args.operatorId) &&
  Number(row.sequence) === Number(args.sequence) &&
  String(row.requestHash) === String(args.requestHash)

const claimOutput = (command: Row, replayed: boolean) => ({ ok: true, replayed, command })

export const syncFunctions: Record<string, FnSpec> = {
  claimSyncCommand: defineFn({
    input: {
      id: 'id',
      commandId: 'text',
      deviceId: 'text',
      configId: 'id',
      operatorId: 'text',
      sequence: 'int',
      operation: 'text',
      aggregateType: 'text',
      aggregateId: 'text',
      aggregateRevision: 'int',
      dependencyIds: 'json',
      capturedAt: 'datetime',
      idempotencyKey: 'text',
      requestHash: 'text',
      request: 'json',
    },
    output: { ok: 'bool', replayed: 'bool?', command: 'json?', reason: 'text?', retryable: 'bool?' },
    effects: ['read:pos_channel.SyncCommand', 'write:pos_channel.SyncCommand'],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      const now = Date.now()
      const current = (
        await ctx.db.select('pos_channel.SyncCommand', {
          commandId: args.commandId,
        })
      )[0]
      if (current) {
        if (!sameClaim(current, args)) return { ok: false, reason: 'command_conflict' }
        if (current.state !== 'processing') return claimOutput(current, true)
        if (new Date(String(current.leaseUntil)).getTime() > now)
          return { ok: false, reason: 'command_in_flight', retryable: true }
        const leaseToken = randomUUID()
        const leaseUntil = new Date(now + LEASE_MS).toISOString()
        await ctx.db.update(
          'pos_channel.SyncCommand',
          { id: current.id, leaseToken: current.leaseToken, state: 'processing' },
          { leaseToken, leaseUntil, attempts: Number(current.attempts ?? 1) + 1 },
        )
        const reclaimed = (await ctx.db.select('pos_channel.SyncCommand', { id: current.id }))[0]
        return reclaimed && reclaimed.leaseToken === leaseToken
          ? claimOutput(reclaimed, false)
          : { ok: false, reason: 'command_in_flight', retryable: true }
      }

      const occupiedSequence = (
        await ctx.db.select('pos_channel.SyncCommand', {
          deviceId: args.deviceId,
          sequence: args.sequence,
        })
      )[0]
      if (occupiedSequence) return { ok: false, reason: 'sequence_conflict' }
      const occupiedKey = (
        await ctx.db.select('pos_channel.SyncCommand', {
          deviceId: args.deviceId,
          operation: args.operation,
          idempotencyKey: args.idempotencyKey,
        })
      )[0]
      if (occupiedKey) return { ok: false, reason: 'idempotency_conflict' }

      const leaseToken = randomUUID()
      const row = {
        ...args,
        state: 'processing',
        result: null,
        attempts: 1,
        leaseToken,
        leaseUntil: new Date(now + LEASE_MS).toISOString(),
        createdAt: new Date(now).toISOString(),
        completedAt: null,
        expiresAt: new Date(now + COMMAND_RETENTION_MS).toISOString(),
      }
      const inserted = await ctx.db.insertIfAbsent('pos_channel.SyncCommand', row)
      if ('dryRun' in inserted || inserted.inserted) return claimOutput(row, false)
      const raced = (
        await ctx.db.select('pos_channel.SyncCommand', {
          commandId: args.commandId,
        })
      )[0]
      return raced && sameClaim(raced, args)
        ? raced.state === 'processing'
          ? { ok: false, reason: 'command_in_flight', retryable: true }
          : claimOutput(raced, true)
        : { ok: false, reason: 'command_conflict' }
    },
  }),
  completeSyncCommand: defineFn({
    input: {
      id: 'id',
      deviceId: 'text',
      leaseToken: 'text',
      state: 'text',
      result: 'json',
    },
    output: { ok: 'bool', command: 'json?', reason: 'text?' },
    effects: ['read:pos_channel.SyncCommand', 'write:pos_channel.SyncCommand'],
    idempotent: true,
    exposure: 'internal',
    handler: async (ctx, args) => {
      if (!['accepted', 'conflict', 'refused'].includes(String(args.state)))
        return { ok: false, reason: 'state_invalid' }
      const held = (await ctx.db.select('pos_channel.SyncCommand', { id: args.id }))[0]
      if (!held || String(held.deviceId) !== String(args.deviceId))
        return { ok: false, reason: 'command_missing' }
      if (held.state !== 'processing') return { ok: true, command: held }
      if (String(held.leaseToken) !== String(args.leaseToken)) return { ok: false, reason: 'lease_lost' }
      await ctx.db.update(
        'pos_channel.SyncCommand',
        { id: held.id, state: 'processing', leaseToken: args.leaseToken },
        {
          state: args.state,
          result: args.result,
          completedAt: new Date().toISOString(),
          leaseUntil: new Date(0).toISOString(),
        },
      )
      const completed = (await ctx.db.select('pos_channel.SyncCommand', { id: held.id }))[0]
      return completed?.state === args.state
        ? { ok: true, command: completed }
        : { ok: false, reason: 'lease_lost' }
    },
  }),
  getSyncCommand: defineFn({
    input: { commandId: 'text' },
    output: { command: 'json?' },
    effects: ['read:pos_channel.SyncCommand'],
    exposure: 'internal',
    handler: async (ctx, args) => ({
      command: (await ctx.db.select('pos_channel.SyncCommand', { commandId: args.commandId }))[0] ?? null,
    }),
  }),
  listDeviceSyncCommands: defineFn({
    input: { deviceId: 'text', configId: 'id' },
    output: { commands: 'json' },
    effects: ['read:pos_channel.SyncCommand'],
    exposure: 'internal',
    handler: async (ctx, args) => ({
      commands: await ctx.db.select('pos_channel.SyncCommand', {
        deviceId: args.deviceId,
        configId: args.configId,
      }),
    }),
  }),
}

const syncError = (ctx: ServeContext, url: URL, req: Req, code: string, status = 409, retryable = false) => ({
  status,
  error: channelError(ctx, url, req, `pos.${code}`, {
    messageKey: `pos_channel.error.${code}`,
    retryable,
  }),
})

const cursorOf = (row: Row): string =>
  Buffer.from(JSON.stringify({ commandId: String(row.commandId), sequence: Number(row.sequence) })).toString(
    'base64url',
  )

const readCursor = (value: unknown): { commandId: string; sequence: number } | null => {
  if (value == null || value === '') return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) as Row
    return typeof parsed.commandId === 'string' &&
      Number.isInteger(parsed.sequence) &&
      Number(parsed.sequence) > 0
      ? { commandId: parsed.commandId, sequence: Number(parsed.sequence) }
      : null
  } catch {
    return null
  }
}

const rowOf = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}

const liveCatalog = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  posConfigId: string,
): Promise<Row | null> => {
  const held = (await ctx.call(
    'pos_channel.priceBook',
    { posConfigId, offset: 0, limit: 1 },
    url,
    req,
  )) as Row | null
  return held?.revision ? held : null
}

const stringOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const referenceCommandId = (value: string): string | null =>
  value.startsWith('command:') && value.length > 'command:'.length ? value.slice('command:'.length) : null

const commandResult = (row: Row): Row => rowOf(row.result)

const loadCommand = async (ctx: ServeContext, url: URL, req: Req, commandId: string): Promise<Row | null> => {
  const found = (await ctx.call('pos_channel.getSyncCommand', { commandId }, url, req)) as Row
  return rowOf(found).command ? rowOf(rowOf(found).command) : null
}

const resolveEntity = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  value: string,
  command: OfflineCommand,
  completed: Map<string, Row>,
): Promise<{ ok: true; id: string } | { ok: false; code: string }> => {
  const reference = referenceCommandId(value)
  if (!reference) return { ok: true, id: value }
  if (!command.dependencyIds.includes(reference)) return { ok: false, code: 'reference_dependency_required' }
  const dependency = completed.get(reference) ?? (await loadCommand(ctx, url, req, reference))
  if (!dependency) return { ok: false, code: 'dependency_missing' }
  const result = commandResult(dependency)
  const entityId = stringOf(result.entityId)
  return dependency.state === 'accepted' && entityId
    ? { ok: true, id: entityId }
    : { ok: false, code: 'dependency_failed' }
}

const domainFailure = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  command: OfflineCommand,
  aggregateId: string,
  result: Row,
  identity: PosIdentity,
) => {
  const issues = Array.isArray(result.errors) ? (result.errors as Row[]) : []
  const fields = issues.map((issue) => String(issue.field ?? 'command'))
  const isConflict = fields.some((field) =>
    ['expectedRevision', 'state', 'quoteRevision', 'priceBookRevision', 'stockRevision'].includes(field),
  )
  const current = await posOrderFor(ctx, url, req, aggregateId, identity)
  return {
    status: isConflict ? 'conflict' : 'refused',
    code: isConflict ? 'aggregate_conflict' : 'command_invalid',
    operation: command.operation,
    commandId: command.commandId,
    issues: fields,
    serverProjection: current ? posProjectOrder(current) : null,
    allowedRecovery: isConflict
      ? fields.some((field) => ['quoteRevision', 'priceBookRevision'].includes(field))
        ? ['reload_catalog', 'reload_aggregate', 'rebase_draft']
        : ['reload_aggregate', 'rebase_draft', 'manual_reconciliation']
      : ['manual_reconciliation'],
  }
}

const execute = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  command: OfflineCommand,
  identity: PosIdentity,
  completed: Map<string, Row>,
  lease: PosOfflineLeaseClaims,
): Promise<Row> => {
  const payload = rowOf(command.payload)
  const aggregate = await resolveEntity(ctx, url, req, command.aggregateId, command, completed)
  if (!aggregate.ok)
    return {
      status: 'refused',
      code: aggregate.code,
      commandId: command.commandId,
      operation: command.operation,
      allowedRecovery: ['upload_dependency', 'manual_reconciliation'],
    }
  const aggregateId = aggregate.id
  const actionByOperation: Record<OfflineOperation, string> = {
    'pos.orders.create': 'order.create',
    'pos.orders.update': 'order.update',
    'pos.orders.lines.add': 'order.line.add',
    'pos.orders.lines.update': 'order.line.update',
    'pos.orders.lines.lots.select': 'order.line.lots.select',
    'pos.orders.lines.remove': 'order.line.remove',
    'pos.orders.lines.reorder': 'order.line.reorder',
    'pos.orders.tenders.add': 'order.tender.add',
    'pos.orders.tenders.void': 'order.tender.void',
    'pos.orders.finalize': 'order.finalize',
    'pos.orders.cancel': 'order.cancel',
  }
  const options = posCommandOptions(identity, actionByOperation[command.operation], command.idempotencyKey)
  const call = async (name: string, args: Row) => (await ctx.call(name, args, url, req, options)) as Row
  let result: Row
  let entityId = aggregateId

  if (command.operation === 'pos.orders.create') {
    if (command.aggregateRevision !== 0)
      return { status: 'refused', code: 'create_revision_invalid', commandId: command.commandId }
    const shiftId = stringOf(payload.shiftId)
    const uuid = stringOf(payload.uuid)
    const priceBookRevision = stringOf(payload.priceBookRevision)
    if (!shiftId || !uuid || !priceBookRevision)
      return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
    if (shiftId !== lease.shiftId || priceBookRevision !== lease.priceBookRevision)
      return { status: 'refused', code: 'lease_evidence_mismatch', commandId: command.commandId }
    if (!(await posShiftFor(ctx, url, req, shiftId, identity)))
      return { status: 'refused', code: 'shift_unavailable', commandId: command.commandId }
    const current = await liveCatalog(ctx, url, req, identity.posConfigId)
    if (!current || current.revision !== priceBookRevision)
      return {
        status: 'conflict',
        code: 'catalog_changed',
        commandId: command.commandId,
        serverProjection: current ? { masterVersion: current.revision, revisions: current.revisions } : null,
        allowedRecovery: ['reload_catalog', 'reprice_draft'],
      }
    entityId = channelCommandId('order', identity, command.idempotencyKey)
    result = await call('pos.createOrder', {
      id: entityId,
      uuid,
      sessionId: shiftId,
      partnerId: stringOf(payload.customerId) ?? undefined,
      note: stringOf(payload.note) ?? undefined,
      operatorId: identity.operatorId,
      deviceId: identity.deviceId,
      priceBookRevision,
    })
  } else {
    const held = await posOrderFor(ctx, url, req, aggregateId, identity)
    if (!held) return { status: 'refused', code: 'aggregate_unavailable', commandId: command.commandId }
    if (String(held.sessionId) !== lease.shiftId)
      return { status: 'refused', code: 'lease_shift_mismatch', commandId: command.commandId }
    if (Number(held.revision ?? 0) !== command.aggregateRevision)
      return {
        status: 'conflict',
        code: 'aggregate_conflict',
        commandId: command.commandId,
        operation: command.operation,
        serverProjection: posProjectOrder(held),
        allowedRecovery: ['reload_aggregate', 'rebase_draft'],
      }

    switch (command.operation) {
      case 'pos.orders.update':
        result = await call('pos.updateOrder', {
          id: aggregateId,
          expectedRevision: command.aggregateRevision,
          partnerId: payload.customerId === null ? undefined : (stringOf(payload.customerId) ?? undefined),
          clearPartner: payload.customerId === null,
          note: stringOf(payload.note) ?? undefined,
        })
        break
      case 'pos.orders.lines.add': {
        const productId = stringOf(payload.productId)
        const uomId = stringOf(payload.uomId)
        const quantity = stringOf(payload.quantity)
        const quoteRevision = stringOf(payload.quoteRevision)
        if (!productId || !uomId || !quantity || !quoteRevision)
          return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
        if (quoteRevision !== lease.priceBookRevision)
          return { status: 'refused', code: 'lease_evidence_mismatch', commandId: command.commandId }
        const current = await liveCatalog(ctx, url, req, identity.posConfigId)
        if (
          !current ||
          String(held.priceBookRevision ?? '') !== quoteRevision ||
          current.revision !== quoteRevision
        )
          return {
            status: 'conflict',
            code: 'catalog_changed',
            commandId: command.commandId,
            serverProjection: posProjectOrder(held),
            allowedRecovery: ['reload_catalog', 'reprice_draft'],
          }
        entityId = channelCommandId('line', identity, `${aggregateId}\n${command.idempotencyKey}`)
        result = await call('pos.addLine', {
          id: entityId,
          orderId: aggregateId,
          productId,
          productUomId: uomId,
          qty: quantity,
          quoteRevision,
          expectedRevision: command.aggregateRevision,
        })
        break
      }
      case 'pos.orders.lines.update': {
        const line = await resolveEntity(ctx, url, req, stringOf(payload.lineId) ?? '', command, completed)
        if (!line.ok) return { status: 'refused', code: line.code, commandId: command.commandId }
        const quantity = stringOf(payload.quantity)
        if (!quantity) return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
        result = await call('pos.updateLine', {
          id: line.id,
          orderId: aggregateId,
          expectedRevision: command.aggregateRevision,
          qty: quantity,
          quoteRevision: payload.quoteRevision,
          sequence: payload.sequence,
        })
        entityId = line.id
        break
      }
      case 'pos.orders.lines.lots.select': {
        const line = await resolveEntity(ctx, url, req, stringOf(payload.lineId) ?? '', command, completed)
        if (!line.ok) return { status: 'refused', code: line.code, commandId: command.commandId }
        if (!Array.isArray(payload.selections) || payload.selections.length === 0)
          return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
        result = await call('pos.setLineLotSelections', {
          orderId: aggregateId,
          lineId: line.id,
          expectedRevision: command.aggregateRevision,
          selections: payload.selections,
        })
        entityId = line.id
        break
      }
      case 'pos.orders.lines.remove': {
        const line = await resolveEntity(ctx, url, req, stringOf(payload.lineId) ?? '', command, completed)
        if (!line.ok) return { status: 'refused', code: line.code, commandId: command.commandId }
        result = await call('pos.removeLine', {
          id: line.id,
          orderId: aggregateId,
          expectedRevision: command.aggregateRevision,
        })
        entityId = line.id
        break
      }
      case 'pos.orders.lines.reorder': {
        if (!Array.isArray(payload.lineIds))
          return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
        const lineIds: string[] = []
        for (const reference of payload.lineIds) {
          const line = await resolveEntity(ctx, url, req, String(reference), command, completed)
          if (!line.ok) return { status: 'refused', code: line.code, commandId: command.commandId }
          lineIds.push(line.id)
        }
        result = await call('pos.reorderLines', {
          id: aggregateId,
          expectedRevision: command.aggregateRevision,
          lineIds,
        })
        break
      }
      case 'pos.orders.tenders.add': {
        const paymentMethodId = stringOf(payload.paymentMethodId)
        const tenderedAmount = stringOf(payload.tenderedAmount)
        if (!paymentMethodId || !tenderedAmount)
          return { status: 'refused', code: 'payload_invalid', commandId: command.commandId }
        const maxTenderAmount = Number(lease.ceilings.maxTenderAmount ?? Number.POSITIVE_INFINITY)
        if (!Number.isFinite(Number(tenderedAmount)) || Number(tenderedAmount) > maxTenderAmount)
          return { status: 'refused', code: 'lease_ceiling_exceeded', commandId: command.commandId }
        entityId = channelCommandId('tender', identity, `${aggregateId}\n${command.idempotencyKey}`)
        result = await call('pos.addPayment', {
          id: entityId,
          orderId: aggregateId,
          expectedRevision: command.aggregateRevision,
          paymentMethodId,
          tenderedAmount,
          reference: stringOf(payload.reference) ?? undefined,
          operatorId: identity.operatorId,
          deviceId: identity.deviceId,
        })
        break
      }
      case 'pos.orders.tenders.void': {
        const tender = await resolveEntity(
          ctx,
          url,
          req,
          stringOf(payload.tenderId) ?? '',
          command,
          completed,
        )
        if (!tender.ok) return { status: 'refused', code: tender.code, commandId: command.commandId }
        result = await call('pos.voidPayment', {
          id: tender.id,
          orderId: aggregateId,
          expectedRevision: command.aggregateRevision,
          reason: stringOf(payload.reason) ?? 'offline correction',
          operatorId: identity.operatorId,
        })
        entityId = tender.id
        break
      }
      case 'pos.orders.finalize':
        if (Number(held.amountTotal ?? 0) > Number(lease.ceilings.maxOrderTotal ?? Number.POSITIVE_INFINITY))
          return { status: 'refused', code: 'lease_ceiling_exceeded', commandId: command.commandId }
        result = await call(
          await posLifecycleFunction(ctx, req, 'loyalty_pos.validateOrder', 'pos.validateOrder'),
          {
            id: aggregateId,
            expectedRevision: command.aggregateRevision,
          },
        )
        break
      case 'pos.orders.cancel':
        result = await call(
          await posLifecycleFunction(ctx, req, 'loyalty_pos.cancelOrder', 'pos.cancelOrder'),
          {
            id: aggregateId,
            expectedRevision: command.aggregateRevision,
          },
        )
        break
      default:
        return { status: 'refused', code: 'operation_online_only', commandId: command.commandId }
    }
  }

  const orderId = command.operation === 'pos.orders.create' ? entityId : aggregateId
  if (result.ok !== true) return domainFailure(ctx, url, req, command, orderId, result, identity)
  const order = await posOrderFor(ctx, url, req, orderId, identity)
  return order
    ? {
        status: 'accepted',
        commandId: command.commandId,
        operation: command.operation,
        entityId,
        aggregateId: String(order.id),
        aggregateRevision: Number(order.revision ?? 0),
        projection: posProjectOrder(order),
      }
    : {
        status: 'refused',
        code: 'aggregate_unavailable',
        commandId: command.commandId,
      }
}

const normalizeCommand = (value: unknown): OfflineCommand | null => {
  const row = rowOf(value)
  const operation = stringOf(row.operation)
  const dependencyIds = Array.isArray(row.dependencyIds) ? row.dependencyIds.map(String) : null
  const capturedAt = stringOf(row.capturedAt)
  const parsedCapturedAt = capturedAt ? new Date(capturedAt).getTime() : Number.NaN
  if (
    !stringOf(row.commandId) ||
    String(row.commandId).length < 8 ||
    !Number.isInteger(row.sequence) ||
    Number(row.sequence) < 1 ||
    !dependencyIds ||
    dependencyIds.length > MAX_DEPENDENCIES ||
    new Set(dependencyIds).size !== dependencyIds.length ||
    dependencyIds.includes(String(row.commandId)) ||
    row.aggregateType !== 'order' ||
    !stringOf(row.aggregateId) ||
    !Number.isInteger(row.aggregateRevision) ||
    Number(row.aggregateRevision) < 0 ||
    !operation ||
    !OFFLINE_OPERATIONS.includes(operation as OfflineOperation) ||
    !capturedAt ||
    !Number.isFinite(parsedCapturedAt) ||
    !stringOf(row.idempotencyKey) ||
    String(row.idempotencyKey).length < 8 ||
    String(row.idempotencyKey).length > 200 ||
    !row.payload ||
    typeof row.payload !== 'object' ||
    Array.isArray(row.payload) ||
    !stringOf(row.signature) ||
    String(row.signature).length < 32 ||
    String(row.signature).length > 1_024
  )
    return null
  return {
    commandId: String(row.commandId),
    sequence: Number(row.sequence),
    dependencyIds,
    aggregateType: 'order',
    aggregateId: String(row.aggregateId),
    aggregateRevision: Number(row.aggregateRevision),
    operation: operation as OfflineOperation,
    capturedAt,
    idempotencyKey: String(row.idempotencyKey),
    payload: row.payload as Row,
    signature: String(row.signature),
  }
}

const dependencyOrder = (commands: OfflineCommand[]): { ordered: OfflineCommand[]; cyclic: Set<string> } => {
  const byId = new Map(commands.map((command) => [command.commandId, command]))
  const pending = new Set(byId.keys())
  const ordered: OfflineCommand[] = []
  while (pending.size) {
    const ready = [...pending]
      .map((id) => byId.get(id)!)
      .filter((command) => command.dependencyIds.every((dependency) => !pending.has(dependency)))
      .sort((left, right) => left.sequence - right.sequence || left.commandId.localeCompare(right.commandId))
    if (!ready.length) break
    for (const command of ready) {
      pending.delete(command.commandId)
      ordered.push(command)
    }
  }
  return {
    ordered: [...ordered, ...[...pending].map((id) => byId.get(id)!).sort((a, b) => a.sequence - b.sequence)],
    cyclic: pending,
  }
}

const claimReasonResult = (command: OfflineCommand, claim: Row): Row => ({
  status: 'refused',
  commandId: command.commandId,
  operation: command.operation,
  code: String(claim.reason ?? 'command_conflict'),
  retryable: Boolean(claim.retryable),
  allowedRecovery: claim.retryable ? ['retry'] : ['manual_reconciliation'],
})

const complete = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  identity: PosIdentity,
  claimed: Row,
  result: Row,
): Promise<Row> => {
  const state = String(result.status)
  const done = (await ctx.call(
    'pos_channel.completeSyncCommand',
    {
      id: claimed.id,
      deviceId: identity.deviceId,
      leaseToken: claimed.leaseToken,
      state: ['accepted', 'conflict'].includes(state) ? state : 'refused',
      result,
    },
    url,
    req,
  )) as Row
  return done.ok === true ? rowOf(done.command) : claimed
}

const commandSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    commandId,
    sequence: { type: 'integer', minimum: 1 },
    dependencyIds: {
      type: 'array',
      maxItems: MAX_DEPENDENCIES,
      uniqueItems: true,
      items: commandId,
    },
    aggregateType: { type: 'string', enum: ['order'] },
    aggregateId: string,
    aggregateRevision: integer,
    operation: { type: 'string', enum: [...OFFLINE_OPERATIONS] },
    capturedAt: { type: 'string', minLength: 20, maxLength: 64 },
    idempotencyKey: commandId,
    payload: { type: 'object' },
    signature: { type: 'string', minLength: 32, maxLength: 1_024 },
  },
  required: [
    'commandId',
    'sequence',
    'dependencyIds',
    'aggregateType',
    'aggregateId',
    'aggregateRevision',
    'operation',
    'capturedAt',
    'idempotencyKey',
    'payload',
    'signature',
  ],
}

export const syncRoutes = routesOf(
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'sync/bootstrap',
    operationId: 'pos.sync.bootstrap',
    summary: 'Read revision vectors and the bounded offline command policy for this live device grant.',
    auth: 'required',
    responses: { '200': envelope(bootstrapSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      const catalog = await liveCatalog(ctx, url, req, identity.posConfigId)
      if (!catalog) return syncError(ctx, url, req, 'syncUnavailable', 404)
      const revisions = rowOf(catalog.revisions)
      const sessions = (await ctx.call('pos.listSessions', {}, url, req)) as Row[]
      const active = sessions
        .filter(
          (row) =>
            String(row.configId) === identity.posConfigId &&
            (!row.deviceId || String(row.deviceId) === identity.deviceId) &&
            ['opening_control', 'opened', 'closing_control'].includes(String(row.state)),
        )
        .sort((left, right) => String(right.startAt ?? '').localeCompare(String(left.startAt ?? '')))[0]
      const commandRows = rowOf(
        await ctx.call(
          'pos_channel.listDeviceSyncCommands',
          { deviceId: identity.deviceId, configId: identity.posConfigId },
          url,
          req,
        ),
      ).commands as Row[]
      const last = (Array.isArray(commandRows) ? commandRows : [])
        .filter((row) => row.state !== 'processing')
        .sort((left, right) => Number(right.sequence) - Number(left.sequence))[0]
      const leaseProvider = posOfflineLeaseProvider()
      const lease =
        leaseProvider && active?.state === 'opened'
          ? await leaseProvider.issue(ctx, url, req, {
              identity,
              shiftId: String(active.id),
              priceBookRevision: String(catalog.revision),
              minSequence: Number(last?.sequence ?? 0) + 1,
              allowedOperationIds: OFFLINE_OPERATIONS,
            })
          : null
      return {
        data: {
          protocolVersion: policy.protocolVersion,
          companyId: identity.companyId,
          posConfigId: identity.posConfigId,
          deviceId: identity.deviceId,
          revisions: {
            config: revisions.config,
            catalog: revisions.catalog,
            price: revisions.price,
            tax: revisions.tax,
            paymentMethods: revisions.paymentMethods,
            capabilities: stableHash(policy),
            master: catalog.revision,
            shift: active ? String(active.revision ?? 0) : null,
          },
          shift: active ? posProjectShift(active) : null,
          paymentMethods: catalog.paymentMethods,
          policy: { ...policy, offlineEnabled: Boolean(lease) },
          offlineLease: lease,
          resumeCursor: last ? cursorOf(last) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'sync/reconcile',
    operationId: 'pos.sync.reconcile',
    summary: 'Reconcile one bounded dependency-ordered offline command batch without duplicate effects.',
    auth: 'required',
    idempotent: true,
    request: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          batchId: commandId,
          leaseToken: { type: 'string', minLength: 64, maxLength: 4_096 },
          resumeCursor: { type: ['string', 'null'], maxLength: 512 },
          commands: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_SIZE,
            items: commandSchema,
          },
        },
        required: ['batchId', 'leaseToken', 'commands'],
      },
    },
    responses: {
      '200': envelope(reconcileSchema),
      '400': envelope({ type: 'null' }),
      '401': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
      '503': envelope({ type: 'null' }),
    },
    handler: async (ctx, url, req, _params, request) => {
      const batchKey = posCommandKey(ctx, url, req)
      if (typeof batchKey !== 'string') return batchKey
      const identity = request.identity!
      const input = Array.isArray(request.body.commands) ? request.body.commands : []
      const commands = input.map(normalizeCommand)
      if (commands.some((command) => !command)) return syncError(ctx, url, req, 'syncCommandInvalid', 422)
      const held = commands as OfflineCommand[]
      if (
        new Set(held.map((command) => command.commandId)).size !== held.length ||
        new Set(held.map((command) => command.sequence)).size !== held.length
      )
        return syncError(ctx, url, req, 'syncCommandDuplicate', 422)

      const leaseProvider = posOfflineLeaseProvider()
      if (!leaseProvider) return syncError(ctx, url, req, 'syncLeaseUnavailable', 503, true)
      const verified = await leaseProvider.verify(ctx, url, req, {
        identity,
        token: String(request.body.leaseToken),
        commands: held,
      })
      if (!verified.ok)
        return syncError(ctx, url, req, verified.code || 'syncLeaseInvalid', 401, verified.retryable === true)
      const lease = verified.claims as PosOfflineLeaseClaims
      const issuedAt = new Date(lease.issuedAt).getTime()
      const expiresAt = new Date(lease.expiresAt).getTime()
      if (
        lease.companyId !== identity.companyId ||
        lease.posConfigId !== identity.posConfigId ||
        lease.deviceId !== identity.deviceId ||
        lease.grantId !== identity.grantId ||
        lease.operatorId !== identity.operatorId ||
        lease.sessionId !== identity.sessionId ||
        lease.deviceSecurityVersion + lease.grantSecurityVersion !== identity.securityVersion ||
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        issuedAt > Date.now() + FUTURE_SKEW_MS ||
        expiresAt + OUTBOX_GRACE_MS <= Date.now()
      )
        return syncError(ctx, url, req, 'syncLeaseInvalid', 401)
      if (
        held.some(
          (command) =>
            command.sequence < lease.minSequence ||
            command.sequence > lease.maxSequence ||
            !lease.allowedOperationIds.includes(command.operation) ||
            new Date(command.capturedAt).getTime() < issuedAt - FUTURE_SKEW_MS ||
            new Date(command.capturedAt).getTime() > expiresAt,
        )
      )
        return syncError(ctx, url, req, 'syncLeaseScope', 409)

      const resume = readCursor(request.body.resumeCursor)
      if (request.body.resumeCursor && !resume) return syncError(ctx, url, req, 'syncCursorInvalid', 409)
      if (resume) {
        const row = await loadCommand(ctx, url, req, resume.commandId)
        if (
          !row ||
          String(row.deviceId) !== identity.deviceId ||
          String(row.configId) !== identity.posConfigId ||
          Number(row.sequence) !== resume.sequence ||
          new Date(String(row.expiresAt)).getTime() <= Date.now()
        )
          return syncError(ctx, url, req, 'syncCursorExpired', 409)
      }

      const { ordered, cyclic } = dependencyOrder(held)
      const completed = new Map<string, Row>()
      const results: Row[] = []
      let last: Row | null = null
      for (const command of ordered) {
        const captured = new Date(command.capturedAt).getTime()
        // A valid ES256 signature is not deterministic. Retries may carry a different signature for
        // the same canonical command, so idempotency must bind the unsigned evidence rather than the
        // transport proof. The lease provider still verifies every presented signature above.
        const requestHash = posOfflineCommandDigest(command)
        const claim = (await ctx.call(
          'pos_channel.claimSyncCommand',
          {
            id: channelCommandId('sync-command', identity, command.commandId),
            commandId: command.commandId,
            deviceId: identity.deviceId,
            configId: identity.posConfigId,
            operatorId: identity.operatorId,
            sequence: command.sequence,
            operation: command.operation,
            aggregateType: command.aggregateType,
            aggregateId: command.aggregateId,
            aggregateRevision: command.aggregateRevision,
            dependencyIds: command.dependencyIds,
            capturedAt: command.capturedAt,
            idempotencyKey: command.idempotencyKey,
            requestHash,
            request: command,
          },
          url,
          req,
        )) as Row
        if (claim.ok !== true) {
          results.push(claimReasonResult(command, claim))
          continue
        }
        const claimed = rowOf(claim.command)
        if (claim.replayed === true) {
          const original = commandResult(claimed)
          results.push({
            ...original,
            status: 'replayed',
            originalStatus: String(claimed.state),
          })
          completed.set(command.commandId, claimed)
          last = !last || Number(claimed.sequence) > Number(last.sequence) ? claimed : last
          continue
        }

        let result: Row
        if (cyclic.has(command.commandId)) {
          result = {
            status: 'refused',
            commandId: command.commandId,
            operation: command.operation,
            code: 'dependency_cycle',
            allowedRecovery: ['repair_outbox'],
          }
        } else if (captured < Date.now() - OUTBOX_GRACE_MS || captured > Date.now() + FUTURE_SKEW_MS) {
          result = {
            status: 'refused',
            commandId: command.commandId,
            operation: command.operation,
            code: captured > Date.now() ? 'captured_at_future' : 'outbox_grace_expired',
            allowedRecovery: ['manual_reconciliation'],
          }
        } else {
          let dependencyFailure: string | null = null
          for (const dependencyId of command.dependencyIds) {
            const dependency = completed.get(dependencyId) ?? (await loadCommand(ctx, url, req, dependencyId))
            if (!dependency) {
              dependencyFailure = 'dependency_missing'
              break
            }
            if (
              String(dependency.deviceId) !== identity.deviceId ||
              String(dependency.configId) !== identity.posConfigId
            ) {
              dependencyFailure = 'cross_device_dependency'
              break
            }
            if (dependency.state !== 'accepted') {
              dependencyFailure = 'dependency_failed'
              break
            }
          }
          result = dependencyFailure
            ? {
                status: 'refused',
                commandId: command.commandId,
                operation: command.operation,
                code: dependencyFailure,
                allowedRecovery: ['upload_dependency', 'manual_reconciliation'],
              }
            : await execute(ctx, url, req, command, identity, completed, lease)
        }

        const completedRow = await complete(ctx, url, req, identity, claimed, result)
        completed.set(command.commandId, completedRow)
        last = !last || Number(completedRow.sequence) > Number(last.sequence) ? completedRow : last
        results.push(result)
      }

      return {
        data: {
          batchId: String(request.body.batchId),
          accepted: results.filter((result) => result.status === 'accepted').length,
          replayed: results.filter((result) => result.status === 'replayed').length,
          conflicted: results.filter((result) => result.status === 'conflict').length,
          refused: results.filter((result) => result.status === 'refused').length,
          results,
          retentionUntil: new Date(Date.now() + COMMAND_RETENTION_MS).toISOString(),
        },
        nextCursor: last
          ? cursorOf(last)
          : typeof request.body.resumeCursor === 'string'
            ? request.body.resumeCursor
            : null,
      }
    },
  }),
)
