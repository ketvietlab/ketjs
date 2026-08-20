import { each, html, signal } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from './client/activity-view.mjs'

export const HOOKS = [
  'activity-record',
  'activity-head',
  'activity-title',
  'activity-schedule-trigger',
  'activity-schedule',
  'activity-field',
  'activity-type',
  'activity-summary',
  'activity-note',
  'activity-date',
  'activity-schedule-actions',
  'activity-attachment',
  'activity-submit',
  'activity-schedule-close',
  'activity-error',
  'activity-list',
  'activity-loading',
  'activity-empty',
  'activity-item',
  'activity-item-head',
  'activity-item-title',
  'activity-type-name',
  'activity-state',
  'activity-item-note',
  'activity-meta',
  'activity-attachments',
  'activity-actions',
  'activity-action-trigger',
  'activity-action-field',
  'activity-action-label',
  'activity-complete',
  'activity-feedback',
  'activity-reschedule',
  'activity-cancel',
  'activity-indicator',
  'activity-indicator-icon',
  'activity-indicator-count',
] as const

const runtime = { each, html, signal }
const props = { resModel: 'product.Template', resId: 'contract', lang: 'en' }
const activeActivity = {
  id: 'activity',
  summary: 'Follow up',
  note: 'Call first',
  typeName: 'To do',
  state: 'overdue',
  dueDate: '2026-08-19',
  assigneeName: 'Author',
  active: true,
  attachments: [{ id: 'attachment', name: 'brief.pdf', href: '/files/attachment' }],
}

export const activityContractCases = (): TemplateResult[] => [
  createRecordActivityView(runtime, props)(),
  createRecordActivityView(runtime, props, { status: 'error', error: 'Request failed' })(),
  createRecordActivityView(runtime, props, { status: 'ready' })(),
  createRecordActivityView(runtime, props, {
    status: 'ready',
    scheduleOpen: true,
    itemAction: 'complete:activity',
    types: [{ id: 'todo', name: 'To do' }],
    activities: [activeActivity],
  })(),
  createRecordActivityView(runtime, props, {
    status: 'ready',
    itemAction: 'reschedule:activity',
    activities: [activeActivity],
  })(),
  createActivityIndicatorView(runtime, { lang: 'en' }, { count: 3, overdue: 2 })(),
]
