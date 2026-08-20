import { createHash } from 'node:crypto'
import { eq, from, KetError } from 'ketjs'
import type { Ctx, Row } from 'ketjs'
import { inboundPlainText } from '../mail_inbound/index.ts'
import type {
  OdooImportBatch,
  OdooImportBinding,
  OdooImportCount,
  OdooImportIssue,
  OdooImportReport,
  OdooImportRow,
} from './types.ts'

const MAX_ROWS = 5_000
const MAX_BINDINGS = 2_000
const SECRET_KEY = /(secret|password|passwd|token|api.?key|authorization|private.?key)/i

const supportedTargets: Record<string, string> = {
  'mail.message.subtype': 'mail.Subtype',
  'mail.activity.type': 'activity.Type',
  'mail.message': 'mail.Message',
  'mail.tracking.value': 'mail.TrackingValue',
  'mail.followers': 'mail.Follower',
  'mail.notification': 'mail.Notification',
  'mail.activity': 'activity.Activity',
  'mail.activity.plan': 'activity.Plan',
  'mail.activity.plan.template': 'activity.PlanStep',
  'calendar.recurrence': 'calendar.Recurrence',
  'calendar.event': 'calendar.Event',
  'calendar.attendee': 'calendar.Attendee',
  'calendar.alarm': 'calendar.Reminder',
  'calendar.event.type': 'calendar.Tag',
  'calendar.event.type.rel': 'calendar.EventTag',
  'ir.attachment': 'storage.Attachment',
  'mail.template': 'mail_transport.Template',
  'mail.mail': 'mail_transport.Delivery',
  'mail.alias.domain': 'mail_inbound.AliasDomain',
  'mail.alias': 'mail_inbound.Alias',
}

const rank: Record<string, number> = {
  'mail.message.subtype': 10,
  'mail.activity.type': 10,
  'mail.activity.plan': 10,
  'mail.alias.domain': 10,
  'calendar.recurrence': 10,
  'calendar.event.type': 10,
  'ir.attachment': 15,
  'mail.template': 15,
  'mail.alias': 15,
  'mail.message': 20,
  'mail.followers': 20,
  'mail.activity': 20,
  'calendar.event': 20,
  'mail.notification': 30,
  'mail.tracking.value': 30,
  'mail.activity.plan.template': 30,
  'mail.mail': 30,
  'calendar.attendee': 30,
  'calendar.alarm': 30,
  'calendar.event.type.rel': 30,
}

class ImportProblem extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.details = details
  }
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ImportProblem('INVALID_VALUE', `${label} must be an object`)
  return value as Record<string, unknown>
}

const textValue = (value: unknown, label: string, fallback?: string): string => {
  const valueText = value === undefined || value === null ? (fallback ?? '') : String(value)
  const clean = valueText.trim()
  if (!clean) throw new ImportProblem('INVALID_VALUE', `${label} cannot be empty`)
  if (clean.length > 10_000) throw new ImportProblem('INVALID_VALUE', `${label} is too long`)
  return clean
}

const optionalText = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === false) return undefined
  const clean = String(value).trim()
  return clean || undefined
}

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  value === undefined || value === null ? fallback : Boolean(value)

const activityCategory = (value: unknown): string => {
  const source = optionalText(value) ?? 'default'
  return (
    (
      {
        default: 'todo',
        todo: 'todo',
        phonecall: 'call',
        call: 'call',
        email: 'email',
        meeting: 'meeting',
        upload_file: 'upload',
        upload: 'upload',
      } as Record<string, string>
    )[source] ?? 'todo'
  )
}

const activityChaining = (value: unknown): string => {
  const source = optionalText(value) ?? 'suggest'
  return ['none', 'suggest', 'trigger'].includes(source) ? source : 'suggest'
}

const messageKind = (value: unknown): string => {
  const source = optionalText(value) ?? 'comment'
  if (['comment', 'note', 'system', 'email'].includes(source)) return source
  if (source === 'notification' || source === 'user_notification') return 'system'
  return 'comment'
}

const integerValue = (value: unknown, label: string, fallback = 0): number => {
  const result = value === undefined || value === null ? fallback : Number(value)
  if (!Number.isSafeInteger(result)) throw new ImportProblem('INVALID_VALUE', `${label} must be an integer`)
  return result
}

const recordId = (value: unknown, label = 'source id'): string => {
  const id = textValue(value, label)
  if (id.length > 200 || /[\r\n]/.test(id))
    throw new ImportProblem('INVALID_SOURCE_ID', `${label} is invalid`)
  return id
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  return value
}

const stableJson = (value: unknown): string => JSON.stringify(stableValue(value))
const digest = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex')
const shortDigest = (value: unknown, length = 24): string => digest(value).slice(0, length)
const jsonObject = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T

const stableTargetId = (databaseUuid: string, model: string, id: string): string =>
  `odoo:${shortDigest(databaseUuid, 12)}:${model.replace(/[^a-z0-9]+/gi, '_')}:${id}`

const stableMapId = (
  sourceId: string,
  sourceModel: string,
  sourceRecordId: string,
  targetModel: string,
): string => `odoo-map:${shortDigest([sourceId, sourceModel, sourceRecordId, targetModel], 32)}`

const parseDate = (value: unknown, label: string): string => {
  const result = textValue(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00.000Z`)))
    throw new ImportProblem('INVALID_DATE', `${label} must be YYYY-MM-DD`)
  return result
}

const parseDatetime = (value: unknown, label: string, conversion: { count: number }): string => {
  const input = textValue(value, label)
  const normalizedInput = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input)
    ? `${input.replace(' ', 'T')}Z`
    : input
  const parsed = new Date(normalizedInput)
  if (Number.isNaN(parsed.valueOf()))
    throw new ImportProblem('INVALID_DATETIME', `${label} must be an ISO or Odoo UTC datetime`)
  const result = parsed.toISOString()
  if (input !== result) conversion.count += 1
  return result
}

const timezone = (value: unknown): string => {
  const zone = optionalText(value) ?? 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date(0))
  } catch {
    throw new ImportProblem('INVALID_TIMEZONE', `unknown IANA timezone ${zone}`)
  }
  return zone
}

const stringArray = (value: unknown): string[] => {
  if (value === undefined || value === null || value === false) return []
  if (!Array.isArray(value)) throw new ImportProblem('INVALID_VALUE', 'expected an array')
  return value.map((item) => recordId(item))
}

const emailAddresses = (value: unknown, label: string): Array<{ address: string; name?: string }> => {
  if (!Array.isArray(value)) throw new ImportProblem('INVALID_EMAIL_RECIPIENT', `${label} must be an array`)
  return value.map((item, index) => {
    const source = typeof item === 'string' ? { address: item } : object(item, `${label}[${index}]`)
    const address = textValue(source.address, `${label}[${index}].address`).toLowerCase()
    if (!address.includes('@') || /[\r\n]/.test(address))
      throw new ImportProblem('INVALID_EMAIL_RECIPIENT', `${label}[${index}] is not a safe email address`)
    const name = optionalText(source.name)
    return { address, ...(name ? { name } : {}) }
  })
}

const secretFree = (value: unknown): { value: unknown; removed: string[] } => {
  const removed: string[] = []
  const walk = (item: unknown, path: string): unknown => {
    if (Array.isArray(item)) return item.map((child, index) => walk(child, `${path}[${index}]`))
    if (!item || typeof item !== 'object') return item
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) removed.push(path ? `${path}.${key}` : key)
      else output[key] = walk(child, path ? `${path}.${key}` : key)
    }
    return output
  }
  return { value: walk(value, ''), removed }
}

const emptyCount = (): OdooImportCount => ({
  received: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  unresolved: 0,
})

const parseBatch = (input: unknown): OdooImportBatch => {
  const raw = object(input, 'batch')
  const mode = raw.mode === 'snapshot' || raw.mode === 'delta' ? raw.mode : null
  if (!mode) throw new ImportProblem('INVALID_MODE', 'mode must be snapshot or delta')
  if (!Array.isArray(raw.rows)) throw new ImportProblem('INVALID_ROWS', 'rows must be an array')
  if (raw.rows.length > MAX_ROWS)
    throw new ImportProblem('BATCH_TOO_LARGE', `at most ${MAX_ROWS} rows are allowed`)
  const bindings = raw.bindings ?? []
  if (!Array.isArray(bindings)) throw new ImportProblem('INVALID_BINDINGS', 'bindings must be an array')
  if (bindings.length > MAX_BINDINGS)
    throw new ImportProblem('BATCH_TOO_LARGE', `at most ${MAX_BINDINGS} bindings are allowed`)
  const rows: OdooImportRow[] = raw.rows.map((item, index) => {
    const row = object(item, `rows[${index}]`)
    return {
      model: textValue(row.model, `rows[${index}].model`),
      id: recordId(row.id, `rows[${index}].id`),
      values: object(row.values, `rows[${index}].values`),
    }
  })
  const parsedBindings: OdooImportBinding[] = bindings.map((item, index) => {
    const binding = object(item, `bindings[${index}]`)
    return {
      sourceModel: textValue(binding.sourceModel, `bindings[${index}].sourceModel`),
      sourceId: recordId(binding.sourceId, `bindings[${index}].sourceId`),
      targetModel: textValue(binding.targetModel, `bindings[${index}].targetModel`),
      targetId: recordId(binding.targetId, `bindings[${index}].targetId`),
    }
  })
  return {
    runId: recordId(raw.runId, 'runId'),
    sourceId: recordId(raw.sourceId, 'sourceId'),
    sourceName: textValue(raw.sourceName, 'sourceName'),
    databaseUuid: textValue(raw.databaseUuid, 'databaseUuid'),
    odooVersion: textValue(raw.odooVersion, 'odooVersion'),
    mode,
    ...(optionalText(raw.previousCursor) ? { previousCursor: optionalText(raw.previousCursor) } : {}),
    cursor: textValue(raw.cursor, 'cursor'),
    bindings: parsedBindings,
    rows,
  }
}

const allowedBindingTarget = (target: string): boolean =>
  [
    'mail.Thread',
    'partner.Partner',
    'user.User',
    'mail.Subtype',
    'activity.Type',
    'storage.Attachment',
  ].includes(target)

const targetExists = async (ctx: Ctx, model: string, id: string): Promise<boolean> => {
  switch (model) {
    case 'mail.Thread': {
      const T = ctx.table('mail.Thread')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'partner.Partner': {
      const T = ctx.table('partner.Partner')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'user.User': {
      const T = ctx.table('user.User')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail.Subtype': {
      const T = ctx.table('mail.Subtype')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'activity.Type': {
      const T = ctx.table('activity.Type')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail.Message': {
      const T = ctx.table('mail.Message')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail.TrackingValue': {
      const T = ctx.table('mail.TrackingValue')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail.Follower': {
      const T = ctx.table('mail.Follower')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail.Notification': {
      const T = ctx.table('mail.Notification')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'activity.Activity': {
      const T = ctx.table('activity.Activity')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'activity.Plan': {
      const T = ctx.table('activity.Plan')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'activity.PlanStep': {
      const T = ctx.table('activity.PlanStep')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.Recurrence': {
      const T = ctx.table('calendar.Recurrence')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.Event': {
      const T = ctx.table('calendar.Event')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.Attendee': {
      const T = ctx.table('calendar.Attendee')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.Reminder': {
      const T = ctx.table('calendar.Reminder')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.Tag': {
      const T = ctx.table('calendar.Tag')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'calendar.EventTag': {
      const T = ctx.table('calendar.EventTag')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'storage.Attachment': {
      const T = ctx.table('storage.Attachment')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail_inbound.AliasDomain': {
      const T = ctx.table('mail_inbound.AliasDomain')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail_inbound.Alias': {
      const T = ctx.table('mail_inbound.Alias')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail_transport.Template': {
      const T = ctx.table('mail_transport.Template')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    case 'mail_transport.Delivery': {
      const T = ctx.table('mail_transport.Delivery')
      return Boolean(await ctx.db.one(from(T).where(eq(T.id, id))))
    }
    default:
      return false
  }
}

interface ProcessState {
  ctx: Ctx
  batch: OdooImportBatch
  apply: boolean
  now: string
  batchChecksum: string
  maps: Map<string, Row>
  available: Map<string, string>
  existence: Map<string, boolean>
  issues: OdooImportIssue[]
  counts: Record<string, OdooImportCount>
  targets: OdooImportReport['targets']
  conversion: { count: number }
}

const mapKey = (sourceModel: string, sourceId: string, targetModel: string): string =>
  `${sourceModel}\u0000${sourceId}\u0000${targetModel}`

const addIssue = (
  state: ProcessState,
  severity: 'warning' | 'error',
  code: string,
  sourceModel: string,
  sourceRecordId: string,
  message: string,
  details?: Record<string, unknown>,
): void => {
  state.issues.push({ severity, code, sourceModel, sourceRecordId, message, ...(details ? { details } : {}) })
}

const existsCached = async (state: ProcessState, model: string, id: string): Promise<boolean> => {
  const key = `${model}\u0000${id}`
  const known = state.existence.get(key)
  if (known !== undefined) return known
  const exists = await targetExists(state.ctx, model, id)
  state.existence.set(key, exists)
  return exists
}

const resolve = async (
  state: ProcessState,
  sourceModel: string,
  sourceRecordId: unknown,
  targetModel: string,
  label: string,
): Promise<string> => {
  const sourceId = recordId(sourceRecordId, label)
  const key = mapKey(sourceModel, sourceId, targetModel)
  const available = state.available.get(key)
  if (available) return available
  const mapped = state.maps.get(key)
  if (!mapped)
    throw new ImportProblem('MISSING_MAPPING', `${label} has no ${targetModel} mapping`, {
      sourceModel,
      sourceId,
      targetModel,
    })
  const targetId = String(mapped.targetId)
  if (!(await existsCached(state, targetModel, targetId)))
    throw new ImportProblem('ORPHAN_MAPPING', `${label} points to missing ${targetModel} ${targetId}`)
  state.available.set(key, targetId)
  return targetId
}

const writeMap = async (
  state: ProcessState,
  sourceModel: string,
  sourceRecordId: string,
  targetModel: string,
  targetId: string,
  checksum: string,
): Promise<void> => {
  const key = mapKey(sourceModel, sourceRecordId, targetModel)
  const existing = state.maps.get(key)
  const target = { sourceModel, sourceId: sourceRecordId, targetModel, targetId }
  state.targets.push(target)
  state.available.set(key, targetId)
  state.existence.set(`${targetModel}\u0000${targetId}`, true)
  if (!state.apply) return
  if (existing) {
    await state.ctx.db.update(
      'odoo_collaboration_import.Map',
      { id: existing.id },
      { checksum, lastRunId: state.batch.runId, importedAt: state.now },
    )
    Object.assign(existing, { checksum, lastRunId: state.batch.runId, importedAt: state.now })
    return
  }
  const row = {
    id: stableMapId(state.batch.sourceId, sourceModel, sourceRecordId, targetModel),
    sourceId: state.batch.sourceId,
    sourceModel,
    sourceRecordId,
    targetModel,
    targetId,
    checksum,
    firstRunId: state.batch.runId,
    lastRunId: state.batch.runId,
    importedAt: state.now,
  }
  await state.ctx.db.insert('odoo_collaboration_import.Map', row)
  state.maps.set(key, row)
}

const processBindings = async (state: ProcessState): Promise<void> => {
  const count = state.counts.$bindings ?? (state.counts.$bindings = emptyCount())
  for (const binding of state.batch.bindings ?? []) {
    count.received += 1
    const sourceModel = textValue(binding.sourceModel, 'binding source model')
    const sourceId = recordId(binding.sourceId, 'binding source id')
    const targetModel = textValue(binding.targetModel, 'binding target model')
    const targetId = recordId(binding.targetId, 'binding target id')
    if (!allowedBindingTarget(targetModel)) {
      addIssue(
        state,
        'error',
        'UNSUPPORTED_BINDING',
        sourceModel,
        sourceId,
        `binding to ${targetModel} is not allowed`,
      )
      count.unresolved += 1
      continue
    }
    if (!(await existsCached(state, targetModel, targetId))) {
      addIssue(
        state,
        'error',
        'MISSING_TARGET',
        sourceModel,
        sourceId,
        `${targetModel} ${targetId} does not exist`,
      )
      count.unresolved += 1
      continue
    }
    const key = mapKey(sourceModel, sourceId, targetModel)
    const checksum = digest(binding)
    const existing = state.maps.get(key)
    if (existing && String(existing.targetId) !== targetId) {
      addIssue(
        state,
        'error',
        'BINDING_CONFLICT',
        sourceModel,
        sourceId,
        `stable mapping already points to ${existing.targetModel} ${existing.targetId}`,
      )
      count.unresolved += 1
      continue
    }
    if (existing && existing.checksum === checksum) {
      state.available.set(key, targetId)
      count.skipped += 1
      continue
    }
    await writeMap(state, sourceModel, sourceId, targetModel, targetId, checksum)
    if (existing) count.updated += 1
    else count.inserted += 1
  }
}

const targetRow = async (
  state: ProcessState,
  sourceModel: string,
  sourceId: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const targetId = stableTargetId(state.batch.databaseUuid, sourceModel, sourceId)
  switch (sourceModel) {
    case 'mail.message.subtype':
      return {
        id: targetId,
        code: optionalText(values.code) ?? `odoo.${sourceId}`,
        name: textValue(values.name, 'subtype name'),
        defaultFollower: booleanValue(values.defaultFollower, Boolean(values.default)),
        internalOnly: booleanValue(values.internalOnly, Boolean(values.internal)),
        active: booleanValue(values.active, true),
      }
    case 'mail.activity.type':
      return {
        id: targetId,
        name: textValue(values.name, 'activity type name'),
        category: activityCategory(values.category),
        ...(optionalText(values.icon) ? { icon: optionalText(values.icon) } : {}),
        defaultDelayDays: integerValue(values.defaultDelayDays ?? values.delayCount, 'default delay', 0),
        chainingPolicy: activityChaining(values.chainingPolicy ?? values.chainingType),
        sequence: integerValue(values.sequence, 'sequence', 10),
        active: booleanValue(values.active, true),
      }
    case 'mail.message': {
      const threadId = await resolve(
        state,
        textValue(values.resModel, 'message resModel'),
        values.resId,
        'mail.Thread',
        'message target',
      )
      const subtypeId = values.subtypeId
        ? await resolve(state, 'mail.message.subtype', values.subtypeId, 'mail.Subtype', 'message subtype')
        : undefined
      const authorPartnerId = values.authorPartnerId
        ? await resolve(
            state,
            'res.partner',
            values.authorPartnerId,
            'partner.Partner',
            'message author partner',
          )
        : undefined
      const authorUserId = values.authorUserId
        ? await resolve(state, 'res.users', values.authorUserId, 'user.User', 'message author user')
        : undefined
      return {
        id: targetId,
        threadId,
        ...(subtypeId ? { subtypeId } : {}),
        ...(authorPartnerId ? { authorPartnerId } : {}),
        ...(authorUserId ? { authorUserId } : {}),
        ...(optionalText(values.emailFrom) ? { emailFrom: optionalText(values.emailFrom) } : {}),
        kind: messageKind(values.kind ?? values.messageType),
        direction: optionalText(values.direction) ?? 'internal',
        ...(optionalText(values.subject) ? { subject: optionalText(values.subject) } : {}),
        body: inboundPlainText(
          optionalText(values.bodyText) ?? '',
          optionalText(values.bodyHtml ?? values.body),
        ),
        externalVisible: booleanValue(values.externalVisible, !values.internal),
        createdAt: parseDatetime(values.createdAt ?? values.date, 'message createdAt', state.conversion),
        ...(values.editedAt
          ? { editedAt: parseDatetime(values.editedAt, 'message editedAt', state.conversion) }
          : {}),
      }
    }
    case 'mail.tracking.value':
      return {
        id: targetId,
        messageId: await resolve(state, 'mail.message', values.messageId, 'mail.Message', 'tracking message'),
        field: textValue(values.field ?? values.fieldName, 'tracked field'),
        ...(values.oldValue !== undefined ? { oldValue: values.oldValue } : {}),
        ...(values.newValue !== undefined ? { newValue: values.newValue } : {}),
      }
    case 'mail.followers':
      return {
        id: targetId,
        threadId: await resolve(
          state,
          textValue(values.resModel, 'follower resModel'),
          values.resId,
          'mail.Thread',
          'follower target',
        ),
        partnerId: await resolve(
          state,
          'res.partner',
          values.partnerId,
          'partner.Partner',
          'follower partner',
        ),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'follower createdAt',
          state.conversion,
        ),
      }
    case 'mail.notification': {
      const rawState = optionalText(values.state ?? values.notificationStatus) ?? 'queued'
      const notificationState = ['sent', 'ready'].includes(rawState)
        ? rawState === 'ready'
          ? 'ready'
          : 'sent'
        : ['bounce', 'exception', 'failed', 'canceled'].includes(rawState)
          ? 'failed'
          : 'ready'
      return {
        id: targetId,
        messageId: await resolve(
          state,
          'mail.message',
          values.messageId,
          'mail.Message',
          'notification message',
        ),
        recipientPartnerId: await resolve(
          state,
          'res.partner',
          values.partnerId,
          'partner.Partner',
          'notification partner',
        ),
        ...(values.userId
          ? {
              recipientUserId: await resolve(
                state,
                'res.users',
                values.userId,
                'user.User',
                'notification user',
              ),
            }
          : {}),
        channel: optionalText(values.channel ?? values.notificationType) ?? 'inbox',
        state: notificationState,
        ...(values.readAt
          ? { readAt: parseDatetime(values.readAt, 'notification readAt', state.conversion) }
          : {}),
        ...(optionalText(values.failureReason ?? values.failureType)
          ? { failureReason: optionalText(values.failureReason ?? values.failureType) }
          : {}),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'notification createdAt',
          state.conversion,
        ),
      }
    }
    case 'mail.activity': {
      const active = booleanValue(values.active, !(values.doneAt ?? values.canceledAt))
      return {
        id: targetId,
        threadId: await resolve(
          state,
          textValue(values.resModel, 'activity resModel'),
          values.resId,
          'mail.Thread',
          'activity target',
        ),
        typeId: await resolve(
          state,
          'mail.activity.type',
          values.activityTypeId,
          'activity.Type',
          'activity type',
        ),
        assigneeUserId: await resolve(state, 'res.users', values.userId, 'user.User', 'activity assignee'),
        ...(values.createUid
          ? {
              createdByUserId: await resolve(
                state,
                'res.users',
                values.createUid,
                'user.User',
                'activity creator',
              ),
            }
          : {}),
        summary: optionalText(values.summary) ?? 'Odoo activity',
        ...(optionalText(values.noteText ?? values.note)
          ? { note: inboundPlainText(optionalText(values.noteText) ?? '', optionalText(values.note)) }
          : {}),
        dueDate: parseDate(values.dueDate ?? values.dateDeadline, 'activity due date'),
        active,
        ...(values.doneAt
          ? { doneAt: parseDatetime(values.doneAt, 'activity doneAt', state.conversion) }
          : {}),
        ...(values.canceledAt
          ? { canceledAt: parseDatetime(values.canceledAt, 'activity canceledAt', state.conversion) }
          : {}),
        ...(optionalText(values.feedback) ? { feedback: optionalText(values.feedback) } : {}),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'activity createdAt',
          state.conversion,
        ),
        updatedAt: parseDatetime(
          values.updatedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'activity updatedAt',
          state.conversion,
        ),
      }
    }
    case 'mail.activity.plan':
      return {
        id: targetId,
        name: textValue(values.name, 'activity plan name'),
        ...(optionalText(values.description) ? { description: optionalText(values.description) } : {}),
        active: booleanValue(values.active, true),
      }
    case 'mail.activity.plan.template': {
      const strategy =
        optionalText(values.assigneeStrategy ?? values.responsibleType) === 'specific' ? 'specific' : 'actor'
      const assigneeUserId = values.userId
        ? await resolve(state, 'res.users', values.userId, 'user.User', 'plan step assignee')
        : undefined
      if (strategy === 'specific' && !assigneeUserId)
        throw new ImportProblem('MISSING_MAPPING', 'specific plan step requires a mapped user')
      return {
        id: targetId,
        planId: await resolve(state, 'mail.activity.plan', values.planId, 'activity.Plan', 'activity plan'),
        typeId: await resolve(
          state,
          'mail.activity.type',
          values.activityTypeId,
          'activity.Type',
          'plan step activity type',
        ),
        offsetDays: integerValue(values.offsetDays ?? values.interval, 'plan step offset', 0),
        assigneeStrategy: strategy,
        ...(assigneeUserId ? { assigneeUserId } : {}),
        ...(optionalText(values.summary) ? { summary: optionalText(values.summary) } : {}),
        ...(optionalText(values.noteText ?? values.note)
          ? { note: inboundPlainText(optionalText(values.noteText) ?? '', optionalText(values.note)) }
          : {}),
        sequence: integerValue(values.sequence, 'plan step sequence', 10),
      }
    }
    case 'calendar.recurrence': {
      const frequency = optionalText(values.frequency ?? values.rruleType) ?? 'weekly'
      if (!['daily', 'weekly', 'monthly', 'yearly'].includes(frequency))
        throw new ImportProblem(
          'UNSUPPORTED_RECURRENCE',
          `recurrence frequency ${frequency} cannot be represented exactly`,
        )
      const weekdays = Array.isArray(values.weekdays) ? stringArray(values.weekdays) : []
      if (weekdays.some((day) => !['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(day)))
        throw new ImportProblem('UNSUPPORTED_RECURRENCE', 'recurrence contains an unknown weekday')
      return {
        id: targetId,
        frequency,
        interval: integerValue(values.interval, 'recurrence interval', 1),
        ...(weekdays.length ? { weekdays } : {}),
        ...(values.count ? { count: integerValue(values.count, 'recurrence count') } : {}),
        ...(values.until ? { until: parseDate(values.until, 'recurrence until') } : {}),
        timezone: timezone(values.timezone ?? values.tz),
        active: booleanValue(values.active, true),
      }
    }
    case 'calendar.event': {
      const allDay = booleanValue(values.allDay, Boolean(values.allday))
      const recurrenceId = values.recurrenceId
        ? await resolve(
            state,
            'calendar.recurrence',
            values.recurrenceId,
            'calendar.Recurrence',
            'event recurrence',
          )
        : undefined
      return {
        id: targetId,
        threadId: await resolve(state, 'calendar.event', sourceId, 'mail.Thread', 'calendar event thread'),
        organizerUserId: await resolve(
          state,
          'res.users',
          values.organizerUserId ?? values.userId,
          'user.User',
          'event organizer',
        ),
        name: textValue(values.name, 'event name'),
        ...(optionalText(values.descriptionText ?? values.description)
          ? {
              description: inboundPlainText(
                optionalText(values.descriptionText) ?? '',
                optionalText(values.description),
              ),
            }
          : {}),
        ...(optionalText(values.location) ? { location: optionalText(values.location) } : {}),
        allDay,
        ...(allDay
          ? {
              startDate: parseDate(values.startDate, 'event startDate'),
              stopDate: parseDate(values.stopDate, 'event stopDate'),
            }
          : {
              startAt: parseDatetime(values.startAt ?? values.start, 'event startAt', state.conversion),
              stopAt: parseDatetime(values.stopAt ?? values.stop, 'event stopAt', state.conversion),
            }),
        timezone: timezone(values.timezone ?? values.tz),
        privacy: optionalText(values.privacy) ?? 'public',
        showAs: optionalText(values.showAs ?? values.showAsStatus) ?? 'busy',
        ...(recurrenceId ? { recurrenceId } : {}),
        ...(values.recurrenceDate
          ? { recurrenceDate: parseDate(values.recurrenceDate, 'recurrence date') }
          : {}),
        active: booleanValue(values.active, true),
        version: integerValue(values.version, 'event version', 1),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'event createdAt',
          state.conversion,
        ),
        updatedAt: parseDatetime(
          values.updatedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'event updatedAt',
          state.conversion,
        ),
      }
    }
    case 'calendar.attendee':
      return {
        id: targetId,
        eventId: await resolve(state, 'calendar.event', values.eventId, 'calendar.Event', 'attendee event'),
        ...(values.partnerId
          ? {
              partnerId: await resolve(
                state,
                'res.partner',
                values.partnerId,
                'partner.Partner',
                'attendee partner',
              ),
            }
          : {}),
        ...(optionalText(values.email) ? { email: optionalText(values.email) } : {}),
        ...(optionalText(values.name ?? values.commonName)
          ? { name: optionalText(values.name ?? values.commonName) }
          : {}),
        state: optionalText(values.state) ?? 'needsAction',
        token: `odoo-rsvp-${shortDigest([state.batch.databaseUuid, sourceId], 32)}`,
        ...(values.respondedAt
          ? { respondedAt: parseDatetime(values.respondedAt, 'attendee respondedAt', state.conversion) }
          : {}),
      }
    case 'calendar.alarm':
      return {
        id: targetId,
        eventId: await resolve(state, 'calendar.event', values.eventId, 'calendar.Event', 'reminder event'),
        channel: optionalText(values.channel ?? values.alarmType) === 'email' ? 'email' : 'inbox',
        offsetMinutes: integerValue(values.offsetMinutes ?? values.duration, 'reminder offset', 0),
        version: integerValue(values.version, 'reminder version', 1),
        active: booleanValue(values.active, true),
        ...(values.sentAt
          ? { sentAt: parseDatetime(values.sentAt, 'reminder sentAt', state.conversion) }
          : {}),
      }
    case 'calendar.event.type':
      return {
        id: targetId,
        name: textValue(values.name, 'calendar tag name'),
        ...(optionalText(values.color) ? { color: optionalText(values.color) } : {}),
        active: booleanValue(values.active, true),
      }
    case 'calendar.event.type.rel':
      return {
        id: targetId,
        eventId: await resolve(state, 'calendar.event', values.eventId, 'calendar.Event', 'event tag event'),
        tagId: await resolve(state, 'calendar.event.type', values.tagId, 'calendar.Tag', 'event tag'),
      }
    case 'ir.attachment': {
      const rawKind = optionalText(values.kind) ?? (values.url ? 'url' : 'stored')
      const kind = rawKind === 'upload' ? 'stored' : rawKind
      if (!['url', 'stored'].includes(kind))
        throw new ImportProblem('INVALID_ATTACHMENT', 'attachment kind must be stored or url')
      const url = optionalText(values.url)
      const storeKey = optionalText(values.storeKey)
      const checksum = optionalText(values.checksum)
      if ((kind === 'url' && !url) || (kind === 'stored' && (!storeKey || !checksum)))
        throw new ImportProblem(
          'ATTACHMENT_BYTES_MISSING',
          kind === 'url'
            ? 'URL attachment is missing url'
            : 'uploaded bytes must be staged and provide storeKey',
        )
      if (kind === 'stored') {
        if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
          throw new ImportProblem('INVALID_ATTACHMENT', 'stored attachment checksum must be SHA-256')
        const company = state.ctx.scope.company
        const expected = `blobs/${company}/${checksum.slice(0, 2)}/${checksum}`
        if (storeKey !== expected)
          throw new ImportProblem(
            'INVALID_ATTACHMENT',
            'stored attachment key does not match the active company and checksum',
          )
      }
      if (kind === 'url' && (storeKey || checksum))
        throw new ImportProblem('INVALID_ATTACHMENT', 'URL attachment cannot also reference stored bytes')
      return {
        id: targetId,
        name: textValue(values.name, 'attachment name'),
        ...(optionalText(values.resModel) ? { resModel: optionalText(values.resModel) } : {}),
        ...(values.resId ? { resId: recordId(values.resId, 'attachment resId') } : {}),
        ...(optionalText(values.resField) ? { resField: optionalText(values.resField) } : {}),
        kind,
        ...(url ? { url } : {}),
        ...(storeKey ? { storeKey } : {}),
        mimetype: optionalText(values.mimetype) ?? 'application/octet-stream',
        size: integerValue(values.size, 'attachment size', 0),
        ...(checksum ? { checksum } : {}),
        public: booleanValue(values.public, false),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'attachment createdAt',
          state.conversion,
        ),
      }
    }
    case 'mail.template': {
      const subject = textValue(values.subjectTemplate ?? values.subject, 'template subject')
      const html = optionalText(values.htmlTemplate ?? values.bodyHtml)
      const text = optionalText(values.textTemplate ?? values.bodyText) ?? inboundPlainText('', html)
      const qweb = /<t\b|\$\{|\{\{|\bt-(?:esc|out|foreach|if)=/i.test(`${subject}\n${text}\n${html ?? ''}`)
      if (qweb)
        addIssue(
          state,
          'warning',
          'UNSUPPORTED_TEMPLATE_SYNTAX',
          sourceModel,
          sourceId,
          'Odoo QWeb/Jinja syntax was retained only for review; template was disabled',
        )
      const allowedKeys = Array.isArray(values.allowedKeys)
        ? values.allowedKeys.map((item) => textValue(item, 'allowed template key'))
        : []
      return {
        id: targetId,
        name: textValue(values.name, 'template name'),
        fromAddress: textValue(values.fromAddress ?? values.emailFrom, 'template from address'),
        ...(optionalText(values.fromName) ? { fromName: optionalText(values.fromName) } : {}),
        ...(optionalText(values.replyTo) ? { replyTo: optionalText(values.replyTo) } : {}),
        subjectTemplate: subject,
        textTemplate: text,
        ...(html ? { htmlTemplate: html } : {}),
        allowedKeys,
        active: qweb ? false : booleanValue(values.active, true),
        version: integerValue(values.version, 'template version', 1),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'template createdAt',
          state.conversion,
        ),
        updatedAt: parseDatetime(
          values.updatedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'template updatedAt',
          state.conversion,
        ),
      }
    }
    case 'mail.mail': {
      const rawState = optionalText(values.state) ?? 'outgoing'
      const deliveryState = ['exception', 'failed'].includes(rawState) ? 'failed' : 'queued'
      const to = emailAddresses(values.to ?? values.recipientEmails ?? [], 'delivery to')
      if (!to.length)
        throw new ImportProblem('INVALID_EMAIL_RECIPIENT', 'delivery requires at least one recipient')
      const queuedAt = parseDatetime(
        values.queuedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
        'delivery queuedAt',
        state.conversion,
      )
      return {
        id: targetId,
        ...(values.messageId
          ? {
              messageId: await resolve(
                state,
                'mail.message',
                values.messageId,
                'mail.Message',
                'delivery message',
              ),
            }
          : {}),
        fromAddress: textValue(values.fromAddress ?? values.emailFrom, 'delivery from address'),
        ...(optionalText(values.fromName) ? { fromName: optionalText(values.fromName) } : {}),
        to,
        ...(Array.isArray(values.cc) && values.cc.length
          ? { cc: emailAddresses(values.cc, 'delivery cc') }
          : {}),
        ...(Array.isArray(values.bcc) && values.bcc.length
          ? { bcc: emailAddresses(values.bcc, 'delivery bcc') }
          : {}),
        ...(optionalText(values.replyTo) ? { replyTo: optionalText(values.replyTo) } : {}),
        subject: optionalText(values.subject) ?? '(no subject)',
        text: optionalText(values.text) ?? inboundPlainText('', optionalText(values.html ?? values.bodyHtml)),
        ...(optionalText(values.html ?? values.bodyHtml)
          ? { html: optionalText(values.html ?? values.bodyHtml) }
          : {}),
        headers: {},
        state: deliveryState,
        version: 1,
        idempotencyKey: `odoo-mail:${shortDigest([state.batch.databaseUuid, sourceId], 40)}`,
        attempts: integerValue(values.attempts, 'delivery attempts', deliveryState === 'failed' ? 1 : 0),
        ...(deliveryState === 'failed'
          ? { lastError: optionalText(values.failureReason) ?? 'Imported Odoo delivery failure' }
          : {}),
        queuedAt,
        updatedAt: parseDatetime(values.updatedAt ?? queuedAt, 'delivery updatedAt', state.conversion),
      }
    }
    case 'mail.alias.domain':
      return {
        id: targetId,
        name: textValue(values.name, 'alias domain').toLowerCase(),
        active: booleanValue(values.active, true),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'alias domain createdAt',
          state.conversion,
        ),
        updatedAt: parseDatetime(
          values.updatedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'alias domain updatedAt',
          state.conversion,
        ),
      }
    case 'mail.alias': {
      const defaults = secretFree(values.defaults ?? {})
      if (defaults.removed.length)
        addIssue(
          state,
          'warning',
          'SECRET_CONFIG_REMOVED',
          sourceModel,
          sourceId,
          'secret-like alias defaults were not imported',
          { removed: defaults.removed },
        )
      const bridge = textValue(values.bridge, 'alias bridge')
      const supportedBridge = ['stock.receipt'].includes(bridge)
      if (!supportedBridge)
        addIssue(
          state,
          'warning',
          'UNSUPPORTED_ALIAS_BRIDGE',
          sourceModel,
          sourceId,
          `alias bridge ${bridge} was imported disabled`,
        )
      const localPart = textValue(values.localPart ?? values.aliasName, 'alias local part').toLowerCase()
      if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(localPart))
        throw new ImportProblem('INVALID_ALIAS', 'alias local part is invalid')
      return {
        id: targetId,
        ...(values.domainId
          ? {
              domainId: await resolve(
                state,
                'mail.alias.domain',
                values.domainId,
                'mail_inbound.AliasDomain',
                'alias domain',
              ),
            }
          : {}),
        localPart,
        name: textValue(values.name, 'alias name'),
        bridge,
        defaults: defaults.value,
        active: supportedBridge && booleanValue(values.active, true),
        createdAt: parseDatetime(
          values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'alias createdAt',
          state.conversion,
        ),
        updatedAt: parseDatetime(
          values.updatedAt ?? values.createdAt ?? '1970-01-01T00:00:00.000Z',
          'alias updatedAt',
          state.conversion,
        ),
      }
    }
    default:
      throw new ImportProblem('UNSUPPORTED_MODEL', `Odoo model ${sourceModel} is not supported`)
  }
}

const writeTarget = async (
  state: ProcessState,
  targetModel: string,
  targetId: string,
  values: Record<string, unknown>,
  existing: Row | undefined,
): Promise<void> => {
  if (!state.apply) return
  if (existing) await state.ctx.db.update(targetModel, { id: targetId }, values)
  else await state.ctx.db.insert(targetModel, values)
}

const processRows = async (state: ProcessState): Promise<void> => {
  const seen = new Set<string>()
  const rows = [...state.batch.rows].sort(
    (left, right) =>
      (rank[left.model] ?? 1_000) - (rank[right.model] ?? 1_000) ||
      left.model.localeCompare(right.model) ||
      String(left.id).localeCompare(String(right.id), 'en', { numeric: true }),
  )
  const deferred: OdooImportRow[] = []
  for (const source of rows) {
    const sourceModel = textValue(source.model, 'source model')
    const sourceId = recordId(source.id)
    const count = state.counts[sourceModel] ?? (state.counts[sourceModel] = emptyCount())
    count.received += 1
    const targetModel = supportedTargets[sourceModel]
    const duplicateKey = targetModel
      ? mapKey(sourceModel, sourceId, targetModel)
      : `${sourceModel}\u0000${sourceId}`
    if (seen.has(duplicateKey)) {
      addIssue(
        state,
        'error',
        'DUPLICATE_SOURCE_ROW',
        sourceModel,
        sourceId,
        'source row occurs twice in one batch',
      )
      count.unresolved += 1
      continue
    }
    seen.add(duplicateKey)
    if (!targetModel) {
      addIssue(
        state,
        'error',
        'UNSUPPORTED_MODEL',
        sourceModel,
        sourceId,
        `Odoo model ${sourceModel} is not supported`,
      )
      count.unresolved += 1
      continue
    }
    if (sourceModel === 'mail.mail' && String(source.values.state ?? '') === 'sent') {
      addIssue(
        state,
        'warning',
        'SENT_DELIVERY_OMITTED',
        sourceModel,
        sourceId,
        'sent Odoo delivery was omitted because its immutable history is the linked message',
      )
      count.skipped += 1
      continue
    }
    const checksum = digest({ model: sourceModel, id: sourceId, values: source.values })
    const key = mapKey(sourceModel, sourceId, targetModel)
    const mapped = state.maps.get(key)
    const targetId = mapped
      ? String(mapped.targetId)
      : stableTargetId(state.batch.databaseUuid, sourceModel, sourceId)
    if (mapped && mapped.checksum === checksum && (await existsCached(state, targetModel, targetId))) {
      state.available.set(key, targetId)
      state.targets.push({ sourceModel, sourceId, targetModel, targetId })
      count.skipped += 1
      deferred.push(source)
      continue
    }
    try {
      const values = await targetRow(state, sourceModel, sourceId, source.values)
      const targetPresent = mapped ? await existsCached(state, targetModel, targetId) : false
      if (mapped && !targetPresent)
        throw new ImportProblem('ORPHAN_MAPPING', `mapped target ${targetModel} ${targetId} is missing`)
      await writeTarget(state, targetModel, targetId, values, targetPresent ? mapped : undefined)
      await writeMap(state, sourceModel, sourceId, targetModel, targetId, checksum)
      if (mapped) count.updated += 1
      else count.inserted += 1
      deferred.push(source)
    } catch (error) {
      const problem =
        error instanceof ImportProblem
          ? error
          : new ImportProblem('IMPORT_ROW_FAILED', error instanceof Error ? error.message : String(error))
      addIssue(state, 'error', problem.code, sourceModel, sourceId, problem.message, problem.details)
      count.unresolved += 1
    }
  }
  await processDeferred(state, deferred)
}

const processDeferred = async (state: ProcessState, rows: OdooImportRow[]): Promise<void> => {
  for (const source of rows) {
    const sourceId = String(source.id)
    const values = source.values
    try {
      if (source.model === 'mail.message' && values.parentId) {
        const id = await resolve(state, 'mail.message', sourceId, 'mail.Message', 'message')
        const parentId = await resolve(
          state,
          'mail.message',
          values.parentId,
          'mail.Message',
          'message parent',
        )
        if (state.apply) await state.ctx.db.update('mail.Message', { id }, { parentId })
      }
      if (source.model === 'mail.followers') {
        const followerId = await resolve(state, 'mail.followers', sourceId, 'mail.Follower', 'follower')
        for (const subtypeSourceId of stringArray(values.subtypeIds)) {
          const subtypeId = await resolve(
            state,
            'mail.message.subtype',
            subtypeSourceId,
            'mail.Subtype',
            'follower subtype',
          )
          if (state.apply)
            await state.ctx.db.insertIfAbsent('mail.FollowerSubtype', {
              id: `odoo-follower-subtype:${shortDigest([followerId, subtypeId], 32)}`,
              followerId,
              subtypeId,
            })
        }
      }
      if (source.model === 'mail.activity.type' && values.nextTypeId) {
        const id = await resolve(state, 'mail.activity.type', sourceId, 'activity.Type', 'activity type')
        const nextTypeId = await resolve(
          state,
          'mail.activity.type',
          values.nextTypeId,
          'activity.Type',
          'next activity type',
        )
        if (state.apply) await state.ctx.db.update('activity.Type', { id }, { nextTypeId })
      }
      if (source.model === 'calendar.event' && values.exceptionOfEventId) {
        const id = await resolve(state, 'calendar.event', sourceId, 'calendar.Event', 'calendar event')
        const exceptionOfEventId = await resolve(
          state,
          'calendar.event',
          values.exceptionOfEventId,
          'calendar.Event',
          'event exception parent',
        )
        if (state.apply) await state.ctx.db.update('calendar.Event', { id }, { exceptionOfEventId })
      }
      if (source.model === 'ir.attachment' && values.resModel && values.resId) {
        const attachmentId = await resolve(
          state,
          'ir.attachment',
          sourceId,
          'storage.Attachment',
          'attachment',
        )
        const resModel = String(values.resModel)
        if (resModel === 'mail.message') {
          const messageId = await resolve(
            state,
            'mail.message',
            values.resId,
            'mail.Message',
            'attachment message',
          )
          if (state.apply)
            await state.ctx.db.insertIfAbsent('mail.MessageAttachment', {
              id: `odoo-message-attachment:${shortDigest([messageId, attachmentId], 32)}`,
              messageId,
              attachmentId,
            })
        } else if (resModel === 'mail.activity') {
          const activityId = await resolve(
            state,
            'mail.activity',
            values.resId,
            'activity.Activity',
            'attachment activity',
          )
          if (state.apply)
            await state.ctx.db.insertIfAbsent('activity.Attachment', {
              id: `odoo-activity-attachment:${shortDigest([activityId, attachmentId], 32)}`,
              activityId,
              attachmentId,
            })
        } else {
          addIssue(
            state,
            'warning',
            'UNRESOLVED_ATTACHMENT_TARGET',
            source.model,
            sourceId,
            `attachment target model ${resModel} is not linked by this importer`,
          )
        }
      }
      if (source.model === 'mail.mail' && !['exception', 'failed'].includes(String(values.state ?? ''))) {
        const deliveryId = await resolve(state, 'mail.mail', sourceId, 'mail_transport.Delivery', 'delivery')
        if (state.apply)
          await state.ctx.jobs.enqueue(
            'mail_transport.deliver',
            { deliveryId, version: 1 },
            { uniqueKey: `delivery:${deliveryId}:v1` },
          )
      }
    } catch (error) {
      const problem =
        error instanceof ImportProblem
          ? error
          : new ImportProblem('DEFERRED_LINK_FAILED', error instanceof Error ? error.message : String(error))
      addIssue(state, 'error', problem.code, source.model, sourceId, problem.message, problem.details)
    }
  }
}

const totals = (counts: Record<string, OdooImportCount>): OdooImportCount =>
  Object.values(counts).reduce(
    (total, count) => ({
      received: total.received + count.received,
      inserted: total.inserted + count.inserted,
      updated: total.updated + count.updated,
      skipped: total.skipped + count.skipped,
      unresolved: total.unresolved + count.unresolved,
    }),
    emptyCount(),
  )

const processBatch = async (ctx: Ctx, batch: OdooImportBatch, apply: boolean): Promise<OdooImportReport> => {
  const checksum = digest({
    sourceId: batch.sourceId,
    databaseUuid: batch.databaseUuid,
    odooVersion: batch.odooVersion,
    mode: batch.mode,
    previousCursor: batch.previousCursor ?? null,
    cursor: batch.cursor,
    bindings: batch.bindings ?? [],
    rows: batch.rows,
  })
  const R = ctx.table('odoo_collaboration_import.Run')
  const existingRun = await ctx.db.one(from(R).where(eq(R.id, batch.runId)))
  if (existingRun) {
    if (existingRun.batchChecksum !== checksum)
      throw new KetError({
        code: 'E_ODOO_IMPORT_RUN_CONFLICT',
        module: 'odoo_collaboration_import',
        message: `run ${batch.runId} already exists with another payload`,
      })
    return jsonObject<OdooImportReport>(existingRun.report)
  }

  const S = ctx.table('odoo_collaboration_import.Source')
  const source = await ctx.db.one(from(S).where(eq(S.id, batch.sourceId)))
  const databaseOwner = await ctx.db.one(from(S).where(eq(S.databaseUuid, batch.databaseUuid)))
  if (source && source.databaseUuid !== batch.databaseUuid)
    throw new ImportProblem('SOURCE_CONFLICT', `source ${batch.sourceId} belongs to another Odoo database`)
  if (databaseOwner && databaseOwner.id !== batch.sourceId)
    throw new ImportProblem('SOURCE_CONFLICT', `Odoo database is already registered as ${databaseOwner.id}`)
  if (batch.mode === 'delta' && String(source?.lastCursor ?? '') !== String(batch.previousCursor ?? ''))
    throw new KetError({
      code: 'E_ODOO_IMPORT_CHECKPOINT',
      module: 'odoo_collaboration_import',
      message: `delta expected checkpoint ${batch.previousCursor ?? '(empty)'}, current checkpoint is ${source?.lastCursor ?? '(empty)'}`,
    })

  const now = new Date().toISOString()
  if (apply) {
    if (source)
      await ctx.db.update(
        'odoo_collaboration_import.Source',
        { id: batch.sourceId },
        { name: batch.sourceName, odooVersion: batch.odooVersion, updatedAt: now },
      )
    else
      await ctx.db.insert('odoo_collaboration_import.Source', {
        id: batch.sourceId,
        name: batch.sourceName,
        databaseUuid: batch.databaseUuid,
        odooVersion: batch.odooVersion,
        createdAt: now,
        updatedAt: now,
      })
    await ctx.db.insert('odoo_collaboration_import.Run', {
      id: batch.runId,
      sourceId: batch.sourceId,
      mode: batch.mode,
      state: 'running',
      ...(batch.previousCursor ? { previousCursor: batch.previousCursor } : {}),
      cursor: batch.cursor,
      batchChecksum: checksum,
      report: {},
      startedAt: now,
    })
  }

  const M = ctx.table('odoo_collaboration_import.Map')
  const mapRows = await ctx.db.all(from(M).where(eq(M.sourceId, batch.sourceId)))
  const state: ProcessState = {
    ctx,
    batch,
    apply,
    now,
    batchChecksum: checksum,
    maps: new Map(
      mapRows.map((row) => [
        mapKey(String(row.sourceModel), String(row.sourceRecordId), String(row.targetModel)),
        row,
      ]),
    ),
    available: new Map(),
    existence: new Map(),
    issues: [],
    counts: {},
    targets: [],
    conversion: { count: 0 },
  }
  await processBindings(state)
  await processRows(state)
  const report: OdooImportReport = {
    runId: batch.runId,
    sourceId: batch.sourceId,
    mode: batch.mode,
    cursor: batch.cursor,
    batchChecksum: checksum,
    counts: state.counts,
    totals: totals(state.counts),
    warnings: state.issues.filter((issue) => issue.severity === 'warning').length,
    errors: state.issues.filter((issue) => issue.severity === 'error').length,
    timezoneConversions: state.conversion.count,
    targets: state.targets,
    issues: state.issues,
  }
  if (apply) {
    for (const [index, issue] of state.issues.entries())
      await ctx.db.insert('odoo_collaboration_import.Issue', {
        id: `${batch.runId}:issue:${String(index + 1).padStart(5, '0')}`,
        runId: batch.runId,
        severity: issue.severity,
        code: issue.code,
        sourceModel: issue.sourceModel,
        sourceRecordId: issue.sourceRecordId,
        message: issue.message,
        ...(issue.details ? { details: issue.details } : {}),
        resolved: false,
        createdAt: now,
      })
    await ctx.db.update(
      'odoo_collaboration_import.Source',
      { id: batch.sourceId },
      { lastCursor: batch.cursor, lastImportedAt: now, updatedAt: now },
    )
    await ctx.db.update(
      'odoo_collaboration_import.Run',
      { id: batch.runId },
      { state: 'completed', report, completedAt: now },
    )
  }
  return report
}

export const previewOdooBatch = (ctx: Ctx, input: unknown): Promise<OdooImportReport> =>
  processBatch(ctx, parseBatch(input), false)

export const importOdooBatch = (ctx: Ctx, input: unknown): Promise<OdooImportReport> =>
  processBatch(ctx, parseBatch(input), true)

export const odooRollbackManifest = async (
  ctx: Ctx,
  runId: string,
): Promise<{ runId: string; readOnly: true; targets: OdooImportReport['targets']; warning: string }> => {
  const R = ctx.table('odoo_collaboration_import.Run')
  const run = await ctx.db.one(from(R).where(eq(R.id, runId)))
  if (!run) throw new ImportProblem('RUN_NOT_FOUND', `import run ${runId} does not exist`)
  const report = jsonObject<OdooImportReport>(run.report)
  return {
    runId,
    readOnly: true,
    targets: report.targets ?? [],
    warning:
      'This manifest performs no reverse writes. Roll back cutover by returning traffic to the frozen Odoo database; preserve KetSuite for audit.',
  }
}

export { parseBatch, stableTargetId }
