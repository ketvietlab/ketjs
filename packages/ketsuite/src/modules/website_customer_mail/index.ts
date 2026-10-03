import { randomUUID } from 'node:crypto'
import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { queueTemplate, templateKeys, writeTemplate } from '../mail_transport/index.ts'

/**
 * Mailing a website customer the link to choose a new password.
 *
 * `website` keeps the reset itself — who asked, its digest, when it lapses — and owns no mail.
 * This bridge only queues the message on `mail_transport`'s outbox, so delivery, retry and the
 * provider stay in one place.
 *
 * The template is the company's own, found by {@link TEMPLATE_NAME}: it carries the sender
 * address and the wording, which a deployment cannot know. A company without one sends nothing,
 * and the visitor is told the same as everyone else — to ask the shop.
 *
 * The link is in the delivery's body, which `mail_transport` keeps. It is good once and for half
 * an hour, and spending any link voids the others, so the copy kept outlives its use.
 */

export const TEMPLATE_NAME = 'website.customer.password-reset'
/** Every key this bridge puts in a template context. */
export const SAFE_KEYS = Object.freeze(['siteTitle', 'displayName', 'resetUrl'] as const)

const fail = (code: string, message: string): never => {
  throw new KetError({ code, module: 'website_customer_mail', message })
}
const invalid = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, message: `website_customer_mail.error.${key}` }],
})
const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const templateOf = async (ctx: Ctx): Promise<Row | null> => {
  const T = ctx.table('mail_transport.Template')
  return ctx.db.one(from(T).where(eq(T.name, TEMPLATE_NAME)))
}

const functions: Record<string, FnSpec> = {
  /** The company's reset mail as staff edit it, and the values it may use. */
  passwordResetTemplate: {
    input: {},
    output: { template: 'json?', keys: 'json' },
    effects: ['read:mail_transport.Template'],
    handler: async (ctx: Ctx) => {
      const template = await templateOf(ctx)
      return {
        template: template && {
          fromAddress: template.fromAddress,
          fromName: template.fromName ?? '',
          replyTo: template.replyTo ?? '',
          subject: template.subjectTemplate,
          text: template.textTemplate,
          active: template.active === true,
          version: Number(template.version),
        },
        keys: SAFE_KEYS,
      }
    },
  },

  /**
   * Writes the reset mail under its fixed name with only the keys this bridge fills, so the
   * wording can change but never ask for a value the mail would not have.
   */
  savePasswordResetTemplate: {
    input: {
      fromAddress: 'text',
      fromName: 'text?',
      replyTo: 'text?',
      subject: 'text',
      text: 'text',
      active: 'bool',
      expectedVersion: 'int?',
    },
    output: { ok: 'bool', version: 'int?', errors: 'json?' },
    effects: ['read:mail_transport.Template', 'write:mail_transport.Template'],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const fromAddress = String(args.fromAddress ?? '').trim()
        const replyTo = String(args.replyTo ?? '').trim()
        const subject = String(args.subject ?? '').trim()
        const text = String(args.text ?? '')
        if (!address.test(fromAddress)) return invalid('fromAddress', 'invalidAddress')
        if (replyTo && !address.test(replyTo)) return invalid('replyTo', 'invalidAddress')
        if (!subject || /[\r\n]/.test(subject) || /[\r\n]/.test(String(args.fromName ?? '')))
          return invalid('subject', 'invalidSubject')
        const used = templateKeys(`${subject}\n${text}`)
        const unknown = used.find((key) => !(SAFE_KEYS as readonly string[]).includes(key))
        if (unknown) return invalid('text', 'unknownKey')
        // Without the link the mail tells the customer to reset and gives no way to.
        if (!templateKeys(text).includes('resetUrl')) return invalid('text', 'missingLink')
        const existing = await templateOf(tx)
        if ((args.expectedVersion ?? null) !== (existing ? Number(existing.version) : null))
          return invalid('expectedVersion', 'conflict')
        const saved = await writeTemplate(tx, {
          id: String(existing?.id ?? randomUUID()),
          name: TEMPLATE_NAME,
          fromAddress,
          fromName: String(args.fromName ?? '').trim() || null,
          replyTo: replyTo || null,
          subjectTemplate: subject,
          textTemplate: text,
          allowedKeys: [...SAFE_KEYS],
          active: args.active === true,
        })
        return { ok: true, version: saved.version }
      }),
  },

  mailPasswordReset: {
    anonymous: true,
    exposure: 'internal',
    input: { resetId: 'id', siteId: 'id', resetUrl: 'text' },
    output: { queued: 'bool' },
    effects: [
      'read:website.CustomerPasswordReset',
      'read:website.CustomerAccount',
      'read:website.Site',
      'read:mail_transport.Template',
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'write:mail_transport.DeliveryNotification',
      'enqueue:mail_transport.deliver',
    ],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const url = new URL(String(args.resetUrl))
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
          return fail('E_WEBSITE_CUSTOMER_MAIL_URL', 'resetUrl must be an http(s) address')
        const reset = (await tx.db.select('website.CustomerPasswordReset', { id: args.resetId }))[0]
        if (!reset || reset.usedAt) return { queued: false }
        const account = (await tx.db.select('website.CustomerAccount', { id: reset.accountId }))[0]
        const to = String(account?.email ?? '').trim()
        if (!to) return { queued: false }
        const T = tx.table('mail_transport.Template')
        const template = await tx.db.one(from(T).where(eq(T.name, TEMPLATE_NAME), eq(T.active, true)))
        if (!template) return { queued: false }
        const Site = tx.table('website.Site')
        const site = await tx.db.one(from(Site).where(eq(Site.id, args.siteId)))
        await queueTemplate(tx, {
          // One reset, one message: a retry queues nothing new.
          id: `website-customer-reset:${String(reset.id)}`,
          templateId: String(template.id),
          to: [{ address: to }],
          context: {
            siteTitle: String(site?.title || site?.name || ''),
            displayName: String(account?.displayName ?? ''),
            resetUrl: url.href,
          },
        })
        return { queued: true }
      }),
  },
}

export default defineModule({
  name: 'website_customer_mail',
  version: '0.1.0',
  title: 'Email tài khoản khách',
  summary: 'Gửi khách liên kết đặt lại mật khẩu qua email của công ty.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Email tài khoản khách',
      'app.summary': 'Gửi khách liên kết đặt lại mật khẩu qua email của công ty.',
      'app.category': 'Website',
      'error.invalidAddress': 'Địa chỉ email không hợp lệ.',
      'error.invalidSubject': 'Tiêu đề không được để trống hoặc xuống dòng.',
      'error.unknownKey': 'Email chỉ dùng được các biến được liệt kê.',
      'error.missingLink': 'Nội dung phải có {{resetUrl}}, liên kết để khách đặt lại mật khẩu.',
      'error.conflict': 'Mẫu email vừa được người khác sửa. Tải lại trước khi lưu.',
    },
    en: {
      'app.title': 'Customer account email',
      'app.summary': 'Mail customers the link to choose a new password, from the company’s address.',
      'app.category': 'Website',
      'error.invalidAddress': 'The email address is not valid.',
      'error.invalidSubject': 'The subject cannot be empty or span lines.',
      'error.unknownKey': 'The email can only use the listed values.',
      'error.missingLink': 'The body needs {{resetUrl}}, the link the customer resets with.',
      'error.conflict': 'Someone else just changed this email. Reload before saving.',
    },
  },
  depends: ['website', 'mail_transport'],
  functions,
})

export { functions }
