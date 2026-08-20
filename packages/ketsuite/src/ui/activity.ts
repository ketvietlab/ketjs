import { each, html, signal } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from './client/activity-view.mjs'

export const HOOKS = [
  'activity-record',
  'activity-head',
  'activity-title',
  'activity-schedule',
  'activity-field',
  'activity-type',
  'activity-summary',
  'activity-note',
  'activity-date',
  'activity-schedule-actions',
  'activity-attachment',
  'activity-submit',
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

export const activityContractCases = (): TemplateResult[] => [
  createRecordActivityView(runtime, props)(),
  createRecordActivityView(runtime, props, { status: 'error', error: 'Request failed' })(),
  createRecordActivityView(runtime, props, { status: 'ready' })(),
  createRecordActivityView(runtime, props, {
    status: 'ready',
    types: [{ id: 'todo', name: 'To do' }],
    activities: [
      {
        id: 'activity',
        summary: 'Follow up',
        note: 'Call first',
        typeName: 'To do',
        state: 'overdue',
        dueDate: '2026-08-19',
        assigneeName: 'Author',
        active: true,
        attachments: [{ id: 'attachment', name: 'brief.pdf', href: '/files/attachment' }],
      },
    ],
  })(),
  createActivityIndicatorView(runtime, { lang: 'en' }, { count: 3, overdue: 2 })(),
]
