import { each, html, signal } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from './client/activity-view.mjs'

// The controls inside these are `form-control`, the same hook the kit's forms use,
// so they are not listed here: this file names what the activity island adds, not
// what it borrows.
export const HOOKS = [
  'activity-record',
  'activity-head',
  'activity-title',
  'activity-schedule-trigger',
  'activity-schedule',
  'activity-field',
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
  createRecordActivityView(runtime, props).view(),
  createRecordActivityView(runtime, props, { status: 'error', error: 'Request failed' }).view(),
  createRecordActivityView(runtime, props, { status: 'ready' }).view(),
  createRecordActivityView(runtime, props, {
    status: 'ready',
    scheduleOpen: true,
    itemAction: 'complete:activity',
    types: [{ id: 'todo', name: 'To do' }],
    activities: [activeActivity],
  }).view(),
  createRecordActivityView(runtime, props, {
    status: 'ready',
    itemAction: 'reschedule:activity',
    activities: [activeActivity],
  }).view(),
  createActivityIndicatorView(runtime, { lang: 'en' }, { count: 3, overdue: 2 }).view(),
]
