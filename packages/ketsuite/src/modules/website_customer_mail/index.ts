import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { queueTemplate } from '../mail_transport/index.ts'

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

const functions: Record<string, FnSpec> = {
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
    },
    en: {
      'app.title': 'Customer account email',
      'app.summary': 'Mail customers the link to choose a new password, from the company’s address.',
      'app.category': 'Website',
    },
  },
  depends: ['website', 'mail_transport'],
  functions,
})

export { functions }
