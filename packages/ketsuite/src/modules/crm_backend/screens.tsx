import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  AttachmentPanel,
  badge,
  dataTable,
  DefinitionList,
  emptyState,
  Framed,
  icon,
  linkButton,
  RecordActions,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../ui/index.ts'
import type { FormField, Frame, TableGroup } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))
const local = (_: Translator, group: string, value: unknown) => {
  const raw = String(value ?? '')
  const key = `crm.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw || '—'
}
const state = (_: Translator, value: unknown) => {
  const raw = String(value ?? '')
  return badge(
    local(_, 'terminal', raw),
    raw === 'won' ? 'positive' : raw === 'lost' ? 'danger' : 'neutral',
    raw,
  )
}

export const pipelineScreen = (_: Translator, frame: Frame, board: JSXChild, fields: FormField[] = []) => (
  <Framed
    translator={_}
    title={_('crm_backend.pipeline.title')}
    frame={frame}
    body={stack([
      ...(fields.length
        ? [
            <Surface
              tone="subtle"
              padding="compact"
              body={
                <RecordForm
                  action="/admin/crm/pipeline"
                  method="get"
                  layout="inline"
                  fields={fields}
                  submit={_('crm_backend.action.filter')}
                  submitVariant="secondary"
                />
              }
            />,
          ]
        : []),
      board,
    ])}
  />
)

export const permissionScreen = (_: Translator, frame: Frame): TemplateResult => (
  <Framed
    translator={_}
    title={_('crm_backend.permission.title')}
    frame={frame}
    body={emptyState(_('crm_backend.permission.title'), _('crm_backend.permission.hint'))}
  />
)

export const casesScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
  groups: TableGroup<AnyRow>[] = [],
) => (
  <Framed
    translator={_}
    title={_('crm_backend.cases.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/crm/cases"
            fields={fields}
            errors={errors}
            submit={_('crm_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      rows.length || groups.length
        ? dataTable(_, {
            rows,
            groups,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('crm_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/crm/cases/${String(row.id)}`,
                    label: String(row.name),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              { key: 'kind', label: _('crm_backend.field.kind'), cell: (row) => local(_, 'kind', row.kind) },
              {
                key: 'partner',
                label: _('crm_backend.field.partner'),
                cell: (row) => String(row.partnerName ?? '—'),
              },
              {
                key: 'stage',
                label: _('crm_backend.field.stage'),
                cell: (row) => String(row.stageName ?? '—'),
              },
              {
                key: 'assignee',
                label: _('crm_backend.field.assignee'),
                cell: (row) => String(row.assigneeName ?? '—'),
              },
              {
                key: 'state',
                label: _('crm_backend.field.state'),
                cell: (row) => state(_, row.terminalState),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const caseDetailScreen = (
  _: Translator,
  frame: Frame,
  row: AnyRow,
  options: {
    fields: FormField[]
    stages: AnyRow[]
    users: AnyRow[]
    teams: AnyRow[]
    warehouses: AnyRow[]
    plans: AnyRow[]
    activityTypes: AnyRow[]
    duplicates: AnyRow[]
    errors?: string[]
    tab?: string
  },
): TemplateResult => {
  const sales = (row.salesDetail as AnyRow | null) ?? null
  const timeline = (row.timeline as AnyRow[] | undefined) ?? []
  const messages = (row.messages as AnyRow[] | undefined) ?? []
  const attachments = (row.attachments as AnyRow[] | undefined) ?? []
  const activeTab = options.tab ?? 'overview'
  const href = (tab: string) => `/admin/crm/cases/${encodeURIComponent(String(row.id))}?tab=${tab}`
  const endpoint = `/admin/crm/cases/${String(row.id)}`
  const main =
    activeTab === 'sales'
      ? stack([
          <DefinitionList
            title={_('crm_backend.case.tab.sales')}
            items={[
              {
                key: 'revenue',
                term: _('crm_backend.field.expectedRevenue'),
                value: String(sales?.expectedRevenue ?? 0),
              },
              {
                key: 'probability',
                term: _('crm_backend.field.probability'),
                value: String(sales?.probability ?? 0),
              },
              {
                key: 'forecast',
                term: _('crm_backend.field.forecastCategory'),
                value: String(sales?.forecastCategory ?? '—'),
              },
            ]}
          />,
          ...(row.kind === 'opportunity' && options.warehouses.length
            ? [
                <Surface
                  body={
                    <RecordForm
                      action={endpoint}
                      hidden={{ action: 'quotation' }}
                      fields={[
                        {
                          name: 'warehouseId',
                          label: _('crm_backend.field.warehouse'),
                          type: 'select',
                          required: true,
                          options: options.warehouses.map((item) => ({
                            value: String(item.id),
                            label: String(item.name ?? item.code),
                          })),
                        },
                        { name: 'notes', label: _('crm_backend.field.note'), type: 'textarea', span: 'full' },
                      ]}
                      submit={_('crm_backend.quotation.create')}
                      submitVariant="primary"
                    />
                  }
                />,
              ]
            : []),
        ])
      : activeTab === 'activities'
        ? stack([
            <Surface
              body={
                <RecordForm
                  action={endpoint}
                  hidden={{ action: 'scheduleActivity' }}
                  fields={[
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
                      type: 'select',
                      options: options.users.map((item) => ({
                        value: String(item.id),
                        label: String(item.name),
                      })),
                    },
                    { name: 'summary', label: _('crm_backend.field.name'), required: true },
                    { name: 'dueDate', label: _('crm_backend.field.dueAt'), type: 'date', required: true },
                    { name: 'note', label: _('crm_backend.field.note'), type: 'textarea', span: 'full' },
                  ]}
                  submit={_('crm_backend.activity.schedule')}
                  submitVariant="secondary"
                />
              }
            />,
            ...(options.plans.length
              ? [
                  <Surface
                    body={
                      <RecordForm
                        action={endpoint}
                        hidden={{ action: 'applyPlan' }}
                        fields={[
                          {
                            name: 'planId',
                            label: _('crm_backend.planner.plans'),
                            type: 'select',
                            required: true,
                            options: options.plans.map((item) => ({
                              value: String(item.id),
                              label: String(item.name),
                            })),
                          },
                          {
                            name: 'anchorDate',
                            label: _('crm_backend.activity.anchorDate'),
                            type: 'date',
                            required: true,
                          },
                        ]}
                        submit={_('crm_backend.activity.applyPlan')}
                        submitVariant="secondary"
                      />
                    }
                  />,
                ]
              : []),
          ])
        : activeTab === 'timeline'
          ? timeline.length
            ? dataTable(_, {
                rows: timeline,
                id: (item) => String(item.id),
                columns: [
                  {
                    key: 'at',
                    label: _('crm_backend.timeline.at'),
                    cell: (item) => String(item.occurredAt ?? ''),
                  },
                  {
                    key: 'event',
                    label: _('crm_backend.timeline.event'),
                    priority: 'primary',
                    cell: (item) => String(item.body ?? item.eventType ?? '—'),
                  },
                ],
              })
            : empty(_)
          : stack([
              <DefinitionList
                title={_('crm_backend.case.detail')}
                items={[
                  { key: 'kind', term: _('crm_backend.field.kind'), value: local(_, 'kind', row.kind) },
                  { key: 'stage', term: _('crm_backend.field.stage'), value: String(row.stageName ?? '—') },
                  {
                    key: 'partner',
                    term: _('crm_backend.field.partner'),
                    value: String(row.partnerName ?? '—'),
                  },
                  {
                    key: 'assignee',
                    term: _('crm_backend.field.assignee'),
                    value: String(row.assigneeName ?? '—'),
                  },
                ]}
              />,
              <Surface
                body={
                  <RecordForm
                    action={endpoint}
                    hidden={{
                      action: 'save',
                      expectedVersion: String(row.version ?? 0),
                      kind: String(row.kind),
                    }}
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.action.save')}
                    submitVariant="primary"
                  />
                }
              />,
              <Surface
                body={
                  <RecordForm
                    action={endpoint}
                    hidden={{ action: 'move', expectedVersion: String(row.version ?? 0) }}
                    fields={[
                      {
                        name: 'stageId',
                        label: _('crm_backend.field.stage'),
                        type: 'select',
                        value: String(row.stageId),
                        required: true,
                        options: options.stages.map((item) => ({
                          value: String(item.id),
                          label: String(item.name),
                        })),
                      },
                    ]}
                    submit={_('crm_backend.action.move')}
                    submitVariant="secondary"
                  />
                }
              />,
            ])
  const actions = [
    { value: 'refreshScore', label: _('crm_backend.action.refreshScore'), variant: 'secondary' as const },
    ...(row.kind === 'lead'
      ? [{ value: 'convert', label: _('crm_backend.action.convert'), variant: 'primary' as const }]
      : []),
    ...(row.kind === 'opportunity' && row.terminalState === 'open'
      ? [
          { value: 'won', label: _('crm_backend.action.won'), variant: 'primary' as const },
          { value: 'lost', label: _('crm_backend.action.lost'), variant: 'destructive' as const },
        ]
      : []),
  ]
  return (
    <Framed
      translator={_}
      title={String(row.name)}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={local(_, 'kind', row.kind)}
          title={String(row.name)}
          subtitle={`${String(row.partnerName ?? '—')} · ${String(row.stageName ?? '—')}`}
          imageFallback={icon('target')}
          badges={[state(_, row.terminalState)]}
          summary={[
            { id: 'priority', label: _('crm_backend.field.priority'), value: String(row.priority ?? 0) },
            { id: 'score', label: _('crm_backend.field.score'), value: String(row.score ?? 0) },
            { id: 'version', label: _('crm_backend.field.version'), value: String(row.version ?? 0) },
          ]}
          navigation={
            <Tabs
              label={_('crm_backend.case.detail')}
              items={[
                {
                  id: 'overview',
                  label: _('crm_backend.case.tab.overview'),
                  href: href('overview'),
                  active: activeTab === 'overview',
                },
                {
                  id: 'sales',
                  label: _('crm_backend.case.tab.sales'),
                  href: href('sales'),
                  active: activeTab === 'sales',
                },
                {
                  id: 'activities',
                  label: _('crm_backend.case.tab.activities'),
                  href: href('activities'),
                  active: activeTab === 'activities',
                },
                {
                  id: 'timeline',
                  label: _('crm_backend.case.tab.timeline'),
                  href: href('timeline'),
                  active: activeTab === 'timeline',
                  count: timeline.length + messages.length,
                },
              ]}
            />
          }
          controller={<RecordActions action={endpoint} actions={actions} />}
          body={main}
          aside={stack([
            <Section
              title={_('crm_backend.attachments.title')}
              body={
                <AttachmentPanel
                  items={attachments.map((item) => ({
                    id: String(item.id),
                    name: String(item.name),
                    href: `/files/${String(item.id)}`,
                    size: Number(item.size ?? 0),
                    mimetype: String(item.mimetype ?? ''),
                  }))}
                  uploadAction={`${endpoint}/attachments`}
                  emptyTitle={_('crm_backend.attachments.empty')}
                  emptyHint={_('crm_backend.attachments.emptyHint')}
                  chooseLabel={_('crm_backend.attachments.choose')}
                  uploadLabel={_('crm_backend.attachments.upload')}
                />
              }
            />,
            <Section
              title={_('crm_backend.messages.title')}
              body={stack([
                <RecordForm
                  action={endpoint}
                  hidden={{ action: 'message' }}
                  fields={[
                    {
                      name: 'body',
                      label: _('crm_backend.field.message'),
                      type: 'textarea',
                      required: true,
                      span: 'full',
                    },
                  ]}
                  submit={_('crm_backend.action.addNote')}
                  submitVariant="secondary"
                />,
                ...(messages.length
                  ? messages.map((item) => <Surface padding="compact" body={String(item.body)} />)
                  : [empty(_)]),
              ])}
            />,
          ])}
          asideLabel={_('crm_backend.messages.title')}
        />
      }
    />
  )
}

export const plannerScreen = (
  _: Translator,
  frame: Frame,
  options: {
    tab: string
    activities: AnyRow[]
    plans: AnyRow[]
    events: AnyRow[]
    cases: AnyRow[]
    activityTypes: AnyRow[]
    users: AnyRow[]
    errors?: string[]
  },
): TemplateResult => {
  const rows =
    options.tab === 'plans' ? options.plans : options.tab === 'calendar' ? options.events : options.activities
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
            href: `/admin/crm/activities?tab=${id}`,
            active: options.tab === id,
          }))}
        />,
        ...(options.tab === 'mine'
          ? [
              <Surface
                body={
                  <RecordForm
                    action="/admin/crm/activities?tab=mine"
                    hidden={{ action: 'schedule' }}
                    fields={[
                      {
                        name: 'caseId',
                        label: _('crm_backend.planner.target'),
                        type: 'select',
                        required: true,
                        options: options.cases.map((item) => ({
                          value: String(item.id),
                          label: String(item.name),
                        })),
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
                        type: 'select',
                        options: options.users.map((item) => ({
                          value: String(item.id),
                          label: String(item.name),
                        })),
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
        rows.length
          ? dataTable(_, {
              rows,
              id: (item) => String(item.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.field.name'),
                  priority: 'primary',
                  cell: (item) => String(item.name ?? item.summary ?? '—'),
                },
                {
                  key: 'date',
                  label: _('crm_backend.field.dueAt'),
                  cell: (item) => String(item.dueDate ?? item.startAt ?? '—'),
                },
                {
                  key: 'state',
                  label: _('crm_backend.field.state'),
                  cell: (item) => String(item.state ?? '—'),
                },
              ],
            })
          : empty(_),
      ])}
    />
  )
}

export const configurationScreen = (
  _: Translator,
  frame: Frame,
  tab: string,
  rows: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('crm_backend.configuration.title')}
    frame={frame}
    body={stack([
      <Tabs
        label={_('crm_backend.configuration.title')}
        items={['teams', 'stages', 'assignmentRules', 'scoreRules'].map((id) => ({
          id,
          label: _(`crm_backend.configuration.${id}`),
          href: `/admin/crm/configuration?tab=${id}`,
          active: tab === id,
        }))}
      />,
      <Surface
        body={
          <RecordForm
            action={`/admin/crm/configuration?tab=${tab}`}
            fields={fields}
            errors={errors}
            submit={_('crm_backend.action.save')}
            submitVariant="primary"
          />
        }
      />,
      rows.length
        ? dataTable(_, {
            rows,
            id: (item) => String(item.id),
            columns: [
              {
                key: 'name',
                label: _('crm_backend.field.name'),
                priority: 'primary',
                cell: (item) => String(item.name ?? item.code ?? item.id),
              },
              {
                key: 'active',
                label: _('crm_backend.field.active'),
                cell: (item) => String(item.active !== false),
              },
              {
                key: 'version',
                label: _('crm_backend.field.version'),
                cell: (item) => String(item.version ?? 0),
              },
            ],
          })
        : empty(_),
    ])}
  />
)
