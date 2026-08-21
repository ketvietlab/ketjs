import { defineModule, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { calendarActor } from '../calendar/index.ts'
import { queueTemplate } from '../mail_transport/index.ts'

const effects = [
  'read:calendar.Event',
  'read:calendar.Attendee',
  'read:partner.Partner',
  'read:user.User',
  'read:mail.Message',
  'read:mail.Notification',
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]

const displayTime = (event: Row): string =>
  event.allDay
    ? `${String(event.startDate)} – ${String(event.stopDate)} (${String(event.timezone)})`
    : `${String(event.startAt)} – ${String(event.stopAt)} (${String(event.timezone)})`

const functions: Record<string, FnSpec> = {
  sendInvitations: {
    input: { eventId: 'id', templateId: 'id', baseUrl: 'text' },
    output: { deliveryIds: 'json' },
    effects,
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const E = tx.table('calendar.Event')
        const event = await tx.db.one(from(E).where(eq(E.id, args.eventId), eq(E.active, true)))
        if (!event)
          throw new KetError({
            code: 'E_CALENDAR_MAIL_EVENT',
            module: 'calendar_mail_transport',
            message: 'calendar event is missing or cancelled',
          })
        const actor = calendarActor(tx)
        if (event.organizerUserId !== actor) {
          const U = tx.table('user.User')
          const user = await tx.db.one(from(U).where(eq(U.id, actor)))
          if (user?.superuser !== true)
            throw new KetError({
              code: 'E_CALENDAR_MAIL_ORGANIZER',
              module: 'calendar_mail_transport',
              message: 'only the organizer may send invitations',
            })
        }
        let origin: string
        try {
          const url = new URL(String(args.baseUrl))
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
          origin = url.origin
        } catch {
          throw new KetError({
            code: 'E_CALENDAR_MAIL_URL',
            module: 'calendar_mail_transport',
            message: 'baseUrl must be an HTTP(S) origin',
          })
        }
        const A = tx.table('calendar.Attendee')
        const attendees = await tx.db.all(from(A).where(eq(A.eventId, event.id)))
        const partnerIds = attendees.flatMap((row) => (row.partnerId ? [row.partnerId] : []))
        const P = tx.table('partner.Partner')
        const partners = partnerIds.length ? await tx.db.all(from(P).where(inArray(P.id, partnerIds))) : []
        const partnerById = new Map(partners.map((row) => [String(row.id), row]))
        const targets = attendees.map((attendee) => {
          const partner = partnerById.get(String(attendee.partnerId ?? ''))
          const address = String(attendee.email ?? partner?.email ?? '').trim()
          if (!address)
            throw new KetError({
              code: 'E_CALENDAR_MAIL_ADDRESS',
              module: 'calendar_mail_transport',
              message: `attendee "${String(attendee.id)}" has no email address`,
            })
          return {
            attendee,
            address,
            name: String(attendee.name ?? partner?.name ?? address),
          }
        })
        const deliveryIds: string[] = []
        for (const target of targets) {
          const id = `calendar:${String(event.id)}:v${String(event.version)}:${String(target.attendee.id)}`
          await queueTemplate(tx, {
            id,
            templateId: String(args.templateId),
            context: {
              event: {
                id: String(event.id),
                name: String(event.name),
                when: displayTime(event),
                location: String(event.location ?? ''),
                timezone: String(event.timezone),
              },
              attendee: {
                id: String(target.attendee.id),
                name: target.name,
                rsvpUrl: `${origin}/calendar/rsvp/${encodeURIComponent(String(target.attendee.token))}`,
              },
            },
            to: [{ address: target.address, name: target.name }],
            headers: {
              'X-Ket-Calendar-Event': String(event.id),
              'X-Ket-Calendar-Version': String(event.version),
            },
            messageId: `calendar:event:${String(event.id)}:v${String(event.version)}`,
          })
          deliveryIds.push(id)
        }
        return { deliveryIds }
      }),
  },
}

export default defineModule({
  name: 'calendar_mail_transport',
  version: '0.1.0',
  depends: ['calendar', 'mail_transport'],
  install: 'auto',
  app: true,
  title: 'Email lịch',
  summary: 'Producer tường minh tạo delivery snapshot cho từng lời mời lịch.',
  category: 'Năng suất',
  functions,
  messages: {
    vi: {
      'app.title': 'Email lịch',
      'app.summary': 'Producer tường minh tạo delivery snapshot cho từng lời mời lịch.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Calendar email',
      'app.summary': 'Explicit producer of per-attendee calendar invitation snapshots.',
      'app.category': 'Productivity',
    },
  },
})

export { functions }
