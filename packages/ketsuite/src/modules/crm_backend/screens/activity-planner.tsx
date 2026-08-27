import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  RecordForm,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))
const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}

export const plannerScreen = (
  _: Translator,
  frame: Frame,
  options: {
    tab: string
    activities: AnyRow[]
    plans: AnyRow[]
    events: AnyRow[]
    activityTypes: AnyRow[]
    controls?: { caseId?: JSXChild; assignee?: JSXChild }
    errors?: string[]
    locale?: string
  },
): TemplateResult => {
  const endpoint = localized(`/admin/crm/activities?tab=${options.tab}`, options.locale ?? '')
  const rows =
    options.tab === 'plans' ? options.plans : options.tab === 'calendar' ? options.events : options.activities
  const columns =
    options.tab === 'mine'
      ? [
          {
            key: 'name',
            label: _('crm_backend.field.name'),
            priority: 'primary' as const,
            cell: (item: AnyRow) => String(item.summary ?? item.name ?? '—'),
          },
          { key: 'date', label: _('crm_backend.field.dueAt'), cell: (item: AnyRow) => when(item.dueDate) },
          {
            key: 'case',
            label: _('crm_backend.planner.target'),
            // An activity the user cannot navigate from is half a to-do list.
            cell: (item: AnyRow) =>
              item.caseId
                ? linkButton({
                    href: localized(`/admin/crm/cases/${String(item.caseId)}`, options.locale ?? ''),
                    label: String(item.caseName ?? item.caseId),
                    variant: 'tertiary',
                    size: 'compact',
                  })
                : '—',
          },
          {
            key: 'state',
            label: _('crm_backend.field.state'),
            cell: (item: AnyRow) => {
              const value = String(item.state ?? 'planned')
              return badge(
                _.resolves(`crm_backend.activity.${value}`) ? _(`crm_backend.activity.${value}`) : value,
                value === 'overdue' ? 'danger' : value === 'today' ? 'info' : 'neutral',
                value,
              )
            },
          },
          {
            key: 'actions',
            label: _('crm_backend.field.actions'),
            // `activity.complete` and `activity.cancel` were routed but had no
            // control anywhere, so an activity could be scheduled and never
            // closed from the CRM.
            cell: (item: AnyRow) => (
              <>
                <RecordForm
                  action={endpoint}
                  layout="inline"
                  hidden={{ action: 'complete', id: String(item.id) }}
                  fields={[]}
                  submit={_('crm_backend.activity.complete')}
                  submitVariant="secondary"
                  submitSize="compact"
                />
                <RecordForm
                  action={endpoint}
                  layout="inline"
                  hidden={{ action: 'cancel', id: String(item.id) }}
                  fields={[]}
                  submit={_('crm_backend.activity.cancel')}
                  submitVariant="tertiary"
                  submitSize="compact"
                />
              </>
            ),
          },
        ]
      : [
          {
            key: 'name',
            label: _('crm_backend.field.name'),
            priority: 'primary' as const,
            cell: (item: AnyRow) => String(item.name ?? item.summary ?? '—'),
          },
          {
            key: 'date',
            label: _('crm_backend.field.dueAt'),
            cell: (item: AnyRow) => when(item.startAt ?? item.dueDate),
          },
          {
            key: 'detail',
            label: _('crm_backend.planner.target'),
            cell: (item: AnyRow) =>
              item.caseId
                ? linkButton({
                    href: localized(`/admin/crm/cases/${String(item.caseId)}`, options.locale ?? ''),
                    label: String(item.caseName ?? item.caseId),
                    variant: 'tertiary',
                    size: 'compact',
                  })
                : String((item.steps as unknown[] | undefined)?.length ?? '—'),
          },
        ]
  return (
    <Framed
      translator={_}
      title={_('crm_backend.planner.title')}
      frame={frame}
      body={stack([
        <Tabs
          label={_('crm_backend.planner.title')}
          items={['mine', 'plans', 'calendar'].map((id) => ({
            id,
            label: _(`crm_backend.planner.${id}`),
            href: localized(`/admin/crm/activities?tab=${id}`, options.locale ?? ''),
            active: options.tab === id,
          }))}
        />,
        ...(options.tab === 'mine'
          ? [
              <Surface
                body={
                  <RecordForm
                    action={endpoint}
                    hidden={{ action: 'schedule' }}
                    fields={[
                      {
                        name: 'caseId',
                        label: _('crm_backend.planner.target'),
                        required: true,
                        control: options.controls?.caseId,
                      },
                      {
                        name: 'typeId',
                        label: _('crm_backend.activity.type'),
                        type: 'select',
                        options: options.activityTypes.map((item) => ({
                          value: String(item.id),
                          label: String(item.name),
                        })),
                      },
                      {
                        name: 'assigneeUserId',
                        label: _('crm_backend.field.assignee'),
                        control: options.controls?.assignee,
                      },
                      { name: 'summary', label: _('crm_backend.field.name'), required: true },
                      { name: 'dueDate', label: _('crm_backend.field.dueAt'), type: 'date', required: true },
                    ]}
                    errors={options.errors}
                    submit={_('crm_backend.activity.schedule')}
                    submitVariant="primary"
                  />
                }
              />,
            ]
          : []),
        rows.length ? dataTable(_, { rows, id: (item) => String(item.id), columns }) : empty(_),
      ])}
    />
  )
}
