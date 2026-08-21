import { eq, from, inArray, KetError, validateOutboundMessage } from '@ketvietlab/ketjs'
import type { Ctx, OutboundMessage, Row, TransportAddress } from '@ketvietlab/ketjs'
import { DELIVERY_STATES } from './types.ts'
import type { MailAddress } from './types.ts'
import { jsonValue, renderTemplate, templateKeys } from './template.ts'

const fail = (code: string, message: string): never => {
  throw new KetError({ code, module: 'mail_transport', message })
}

const addresses = (value: unknown, field: string): MailAddress[] => {
  const rows = jsonValue<unknown[]>(value, [])
  if (!Array.isArray(rows)) return fail('E_MAIL_RECIPIENT', `${field} must be an array`)
  return rows.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return fail('E_MAIL_RECIPIENT', `${field}[${index}] must be an address object`)
    const address = String((item as Record<string, unknown>).address ?? '').trim()
    const name = String((item as Record<string, unknown>).name ?? '').trim()
    if (!address?.includes('@') || /[\r\n]/.test(address))
      return fail('E_MAIL_RECIPIENT', `${field}[${index}] is not a safe email address`)
    return { address, ...(name ? { name } : {}) }
  })
}

const record = (value: unknown, field: string): Record<string, unknown> => {
  const parsed = jsonValue<unknown>(value, {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return fail('E_MAIL_JSON', `${field} must be an object`)
  return parsed as Record<string, unknown>
}

const strings = (value: unknown, field: string): string[] => {
  const parsed = jsonValue<unknown>(value, [])
  if (!Array.isArray(parsed)) return fail('E_MAIL_JSON', `${field} must be an array`)
  return [...new Set(parsed.map(String))]
}

export type QueueTemplateInput = {
  id: string
  templateId: string
  context: unknown
  to: unknown
  cc?: unknown
  bcc?: unknown
  headers?: unknown
  messageId?: string
  notificationIds?: unknown
}

const envelopeOf = (row: Row): OutboundMessage => ({
  idempotencyKey: String(row.idempotencyKey),
  from: {
    address: String(row.fromAddress),
    ...(row.fromName ? { name: String(row.fromName) } : {}),
  },
  to: addresses(row.to, 'to') as TransportAddress[],
  ...(addresses(row.cc, 'cc').length ? { cc: addresses(row.cc, 'cc') as TransportAddress[] } : {}),
  ...(addresses(row.bcc, 'bcc').length ? { bcc: addresses(row.bcc, 'bcc') as TransportAddress[] } : {}),
  ...(row.replyTo ? { replyTo: { address: String(row.replyTo) } } : {}),
  subject: String(row.subject),
  text: String(row.text),
  ...(row.html ? { html: String(row.html) } : {}),
  ...(Object.keys(record(row.headers, 'headers')).length
    ? {
        headers: Object.fromEntries(
          Object.entries(record(row.headers, 'headers')).map(([k, v]) => [k, String(v)]),
        ),
      }
    : {}),
})

export const deliveryEnvelope = (row: Row): OutboundMessage => {
  const envelope = envelopeOf(row)
  validateOutboundMessage(envelope)
  return envelope
}

export async function queueTemplate(ctx: Ctx, input: QueueTemplateInput): Promise<Row> {
  const D = ctx.table('mail_transport.Delivery')
  const existing = await ctx.db.one(from(D).where(eq(D.id, input.id)))
  if (existing) return existing

  const T = ctx.table('mail_transport.Template')
  const template = await ctx.db.one(from(T).where(eq(T.id, input.templateId), eq(T.active, true)))
  if (!template) return fail('E_MAIL_TEMPLATE_NOT_FOUND', `no active template "${input.templateId}"`)
  const context = record(input.context, 'context')
  const allowedKeys = strings(template.allowedKeys, 'allowedKeys')
  const declared = templateKeys(
    [template.subjectTemplate, template.textTemplate, template.htmlTemplate ?? ''].join('\n'),
  )
  const forbidden = declared.filter((key) => !allowedKeys.includes(key))
  if (forbidden.length)
    return fail('E_MAIL_TEMPLATE', `template uses non-allowlisted key(s): ${forbidden.join(', ')}`)

  const now = new Date().toISOString()
  const version = 1
  const delivery: Row = {
    id: input.id,
    templateId: template.id,
    templateVersion: template.version,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    fromAddress: template.fromAddress,
    ...(template.fromName ? { fromName: template.fromName } : {}),
    to: addresses(input.to, 'to'),
    ...(addresses(input.cc, 'cc').length ? { cc: addresses(input.cc, 'cc') } : {}),
    ...(addresses(input.bcc, 'bcc').length ? { bcc: addresses(input.bcc, 'bcc') } : {}),
    ...(template.replyTo ? { replyTo: template.replyTo } : {}),
    subject: renderTemplate(String(template.subjectTemplate), context, allowedKeys),
    text: renderTemplate(String(template.textTemplate), context, allowedKeys),
    ...(template.htmlTemplate
      ? { html: renderTemplate(String(template.htmlTemplate), context, allowedKeys, 'html') }
      : {}),
    headers: record(input.headers, 'headers'),
    state: 'queued',
    version,
    idempotencyKey: `mail:${input.id}:v${version}`,
    attempts: 0,
    queuedAt: now,
    updatedAt: now,
  }
  deliveryEnvelope(delivery)

  const notificationIds = strings(input.notificationIds, 'notificationIds')
  if (notificationIds.length) {
    const N = ctx.table('mail.Notification')
    const notifications = await ctx.db.all(from(N).where(inArray(N.id, notificationIds)))
    if (notifications.length !== notificationIds.length)
      return fail('E_MAIL_NOTIFICATION', 'one or more email notifications are outside this company')
    if (notifications.some((row) => row.channel !== 'email'))
      return fail('E_MAIL_NOTIFICATION', 'delivery can only bind email notifications')
  }

  await ctx.db.insert('mail_transport.Delivery', delivery)
  for (const notificationId of notificationIds)
    await ctx.db.insert('mail_transport.DeliveryNotification', {
      id: `${input.id}:${notificationId}`,
      deliveryId: input.id,
      notificationId,
    })
  await ctx.jobs.enqueue(
    'mail_transport.deliver',
    { deliveryId: input.id, version },
    { uniqueKey: `delivery:${input.id}:v${version}` },
  )
  return delivery
}

export const assertDeliveryState = (state: unknown): void => {
  if (!DELIVERY_STATES.includes(String(state) as never))
    fail('E_MAIL_DELIVERY_STATE', `unknown delivery state "${String(state)}"`)
}
