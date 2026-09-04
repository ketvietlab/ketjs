import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { queueTemplate } from '../mail_transport/index.ts'

/**
 * Telling an operator a form submission arrived — without putting the
 * submission in an email.
 *
 * `mail_transport` already owns the outbox: Delivery, retry, dead-letter and
 * the provider events. This module is only the bridge, so `website_form` keeps
 * no delivery state of its own and no second ledger appears.
 *
 * The notification says which form, on which site, when, and where to open it.
 * It carries nothing the visitor typed, and that is a deliberate boundary
 * rather than a default nobody chose:
 *
 *   - A Delivery stores an immutable body snapshot. Putting the payload in the
 *     mail would persist contact data a second time, in another module, in a
 *     row that cannot be edited or purged — while the submission itself is
 *     under a retention policy that promises exactly that.
 *   - `Form.notifyTo` is checked for the shape of an email address and nothing
 *     else. Anyone who may edit a form may point it anywhere. With a bare
 *     notification, doing so leaks that a form was submitted; with the payload,
 *     it is a standing export of everyone's contact details.
 *   - The consent notice a visitor agreed to does not mention an email copy,
 *     and under the versioning contract, changing it to say so would
 *     invalidate every page currently open.
 *
 * Widening this later is additive — a template may ask for more keys once
 * SAFE_KEYS grows. Narrowing it is not: mail that has been sent cannot be
 * recalled from a mailbox, a forward, or a provider's storage.
 */

/** Every key this bridge will ever put in a template context. */
export const SAFE_KEYS = Object.freeze([
  'siteTitle',
  'formName',
  'submissionId',
  'receivedAt',
  'adminUrl',
] as const)

const effects = [
  'read:website_form.Form',
  'read:website_form.FormSubmission',
  'read:website.Site',
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]

const fail = (code: string, message: string): never => {
  throw new KetError({ code, module: 'website_form_mail', message })
}

/** An http(s) origin, and only that: the link is built here, not accepted here. */
const originOf = (value: unknown): string => {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme')
    return url.origin
  } catch {
    return fail('E_WEBSITE_FORM_MAIL_URL', 'baseUrl must be an http(s) origin')
  }
}

/**
 * Build the context from the allowlist rather than from the record.
 *
 * Reading keys off the submission and deleting the unsafe ones would put the
 * safety in a list that has to be kept in step with the schema. Building it the
 * other way round means a field added to a form tomorrow cannot appear here.
 */
const safeContext = (values: Record<(typeof SAFE_KEYS)[number], string>): Record<string, string> => {
  const context: Record<string, string> = {}
  for (const key of SAFE_KEYS) context[key] = values[key]
  return context
}

const functions: Record<string, FnSpec> = {
  notifySubmission: {
    input: { submissionId: 'id', templateId: 'id', baseUrl: 'text' },
    output: { deliveryId: 'id', to: 'text' },
    effects,
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const S = tx.table('website_form.FormSubmission')
        const submission = await tx.db.one(from(S).where(eq(S.id, args.submissionId)))
        if (!submission)
          return fail('E_WEBSITE_FORM_MAIL_SUBMISSION', 'form submission is missing or out of scope')

        const F = tx.table('website_form.Form')
        const form = (await tx.db.one(from(F).where(eq(F.id, submission.formId)))) as Row | null
        if (!form) return fail('E_WEBSITE_FORM_MAIL_FORM', 'the form that owns this submission is missing')
        const to = String(form.notifyTo ?? '').trim()
        if (!to) return fail('E_WEBSITE_FORM_MAIL_DESTINATION', 'the form has nobody to notify')

        const Site = tx.table('website.Site')
        const site = await tx.db.one(from(Site).where(eq(Site.id, form.siteId)))
        const origin = originOf(args.baseUrl)

        const delivery = await queueTemplate(tx, {
          // Derived from the submission, so a retry queues nothing new.
          id: `website-form:${String(submission.id)}`,
          templateId: String(args.templateId),
          to: [{ address: to }],
          context: safeContext({
            siteTitle: String(site?.title ?? ''),
            formName: String(form.name ?? ''),
            submissionId: String(submission.id),
            receivedAt: String(submission.createdAt ?? ''),
            adminUrl: `${origin}/admin/website/forms/${encodeURIComponent(String(form.id))}/submissions/${encodeURIComponent(String(submission.id))}`,
          }),
        })
        return { deliveryId: delivery.id, to }
      }),
  },
}

export default defineModule({
  name: 'website_form_mail',
  version: '0.1.0',
  title: 'Thông báo biểu mẫu',
  summary: 'Báo cho người phụ trách khi có yêu cầu mới, không gửi kèm nội dung khách điền.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Thông báo biểu mẫu',
      'app.summary': 'Báo cho người phụ trách khi có yêu cầu mới, không gửi kèm nội dung khách điền.',
      'app.category': 'Website',
    },
    en: {
      'app.title': 'Form notifications',
      'app.summary': 'Tell the owner a request arrived, without mailing what the visitor wrote.',
      'app.category': 'Website',
    },
  },
  depends: ['website_form', 'mail_transport'],
  functions,
})

export { functions }
