import { DateTimePicker, Stack, Notice, ActionGroup } from '@ketvietlab/design-system'
import { CommandButton } from '../ui.tsx'
import { localDateTime, zonedDateTime } from './format.ts'
import type { Entry, StudioContext } from '../types.ts'

export function scheduleTime(ctx: StudioContext, form: FormData) {
  const at = zonedDateTime(String(form.get('publishAt') ?? ''), ctx.site().timezone)
  if (!at || Date.parse(at) <= Date.now())
    throw Object.assign(new Error(ctx.tr('website.entryPublish.invalidTime')), { code: 'validation' })
  return at
}
export const publishEntry = async (
  ctx: StudioContext,
  entry: Pick<Entry, 'id' | 'revisionId'>,
  publishAt: string | null = null,
) => {
  const result = await ctx.call<Entry>('website.publishEntry', {
    id: entry.id,
    expectedRevisionId: entry.revisionId,
    publishAt,
  })
  ctx.notify(ctx.tr(publishAt ? 'website.entryPublish.scheduled' : 'website.entryPublish.done'))
  return result
}
export const cancelSchedule = async (
  ctx: StudioContext,
  entry: Pick<Entry, 'id' | 'scheduledRevisionId'> & { revisionId?: string | null },
) => {
  await ctx.call('website.cancelScheduledEntry', {
    id: entry.id,
    expectedRevisionId: entry.revisionId,
    expectedScheduledRevisionId: entry.scheduledRevisionId,
  })
  ctx.notify(ctx.tr('website.entryPublish.unscheduled'))
}
/** The scheduled moment as the site's own clock reads it. */
export const scheduledAt = (ctx: StudioContext, at: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ctx.site().timezone ?? 'Asia/Ho_Chi_Minh',
  }).format(new Date(at))
export function EntrySchedule(
  ctx: StudioContext,
  entry: Pick<Entry, 'publishAt' | 'scheduleFailure'>,
  { command, cancel, form }: { command: string; cancel: string; form?: string },
) {
  const disabled = ctx.busy() || !ctx.can('website.publish')
  return (
    <Stack
      items={[
        entry.publishAt ? (
          <Notice
            title={ctx.tr('website.entry.state.scheduled')}
            message={scheduledAt(ctx, entry.publishAt)}
            tone="info"
          />
        ) : null,
        entry.scheduleFailure ? (
          <Notice
            title={ctx.tr('website.entryPublish.failed')}
            message={entry.scheduleFailure.message}
            tone="danger"
          />
        ) : null,
        <DateTimePicker
          id={`${form}-publishAt`}
          name="publishAt"
          label={ctx.tr('website.schedule.at')}
          value={localDateTime(entry.publishAt, ctx.site().timezone)}
          help={ctx.tr('website.entryPublish.timezone', { zone: ctx.site().timezone ?? 'Asia/Ho_Chi_Minh' })}
          disabled={disabled}
        />,
        <p>{ctx.tr('website.entryPublish.scheduleHelp')}</p>,
        <ActionGroup
          actions={[
            <CommandButton
              label={ctx.tr(entry.publishAt ? 'website.schedule.update' : 'website.entryPublish.schedule')}
              command={command}
              type="submit"
              form={form}
              disabled={disabled}
              variant="primary"
            />,
            entry.publishAt ? (
              <CommandButton
                label={ctx.tr('website.schedule.cancel')}
                command={cancel}
                type="button"
                disabled={disabled}
              />
            ) : null,
          ]}
        />,
      ]}
    />
  )
}
