import { html } from '@ketvietlab/ketjs-view'
import { DateTimePicker, Stack, Notice, ActionGroup } from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { localDateTime, zonedDateTime } from './format.mjs'

export function scheduleTime(ctx, form) {
  const at = zonedDateTime(String(form.get('publishAt') ?? ''), ctx.site().timezone)
  if (!at || Date.parse(at) <= Date.now())
    throw Object.assign(new Error(ctx.tr('website.entryPublish.invalidTime')), { code: 'validation' })
  return at
}
export const publishEntry = async (ctx, entry, publishAt = null) => {
  const result = await ctx.call('website.publishEntry', {
    id: entry.id,
    expectedRevisionId: entry.revisionId,
    publishAt,
  })
  ctx.notify(ctx.tr(publishAt ? 'website.entryPublish.scheduled' : 'website.entryPublish.done'))
  return result
}
export const cancelSchedule = async (ctx, entry) => {
  await ctx.call('website.cancelScheduledEntry', {
    id: entry.id,
    expectedRevisionId: entry.revisionId,
    expectedScheduledRevisionId: entry.scheduledRevisionId,
  })
  ctx.notify(ctx.tr('website.entryPublish.unscheduled'))
}
/** The scheduled moment as the site's own clock reads it. */
export const scheduledAt = (ctx, at) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ctx.site().timezone ?? 'Asia/Ho_Chi_Minh',
  }).format(new Date(at))
export function EntrySchedule(ctx, entry, { command, cancel, form }) {
  const disabled = ctx.busy() || !ctx.can('website.publish')
  return h(Stack, {
    items: [
      entry.publishAt
        ? h(Notice, {
            title: ctx.tr('website.entry.state.scheduled'),
            message: scheduledAt(ctx, entry.publishAt),
            tone: 'info',
          })
        : null,
      entry.scheduleFailure
        ? h(Notice, {
            title: ctx.tr('website.entryPublish.failed'),
            message: entry.scheduleFailure.message,
            tone: 'danger',
          })
        : null,
      h(DateTimePicker, {
        id: `${form}-publishAt`,
        name: 'publishAt',
        label: ctx.tr('website.schedule.at'),
        value: localDateTime(entry.publishAt, ctx.site().timezone),
        help: ctx.tr('website.entryPublish.timezone', { zone: ctx.site().timezone ?? 'Asia/Ho_Chi_Minh' }),
        disabled,
      }),
      html`<p>${ctx.tr('website.entryPublish.scheduleHelp')}</p>`,
      h(ActionGroup, {
        actions: [
          CommandButton({
            label: ctx.tr(entry.publishAt ? 'website.schedule.update' : 'website.entryPublish.schedule'),
            command,
            type: 'submit',
            form,
            disabled,
            variant: 'primary',
          }),
          entry.publishAt
            ? CommandButton({
                label: ctx.tr('website.schedule.cancel'),
                command: cancel,
                type: 'button',
                disabled,
              })
            : null,
        ],
      }),
    ],
  })
}
