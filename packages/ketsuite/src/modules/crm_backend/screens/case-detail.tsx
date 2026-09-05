import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  AttachmentPanel,
  badge,
  formatMoney,
  dataTable,
  DefinitionList,
  emptyState,
  icon,
  linkButton,
  modalForm,
  RecordActions,
  RecordForm,
  RecordScreen,
  RecordWorkspace,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

type AnyRow = Record<string, unknown>

const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))
const local = (_: Translator, group: string, value: unknown) => {
  const raw = String(value ?? '')
  const key = `crm.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw || '—'
}
/**
 * A timeline row stores a message key for the events the system writes and free
 * text for the ones a person wrote. Rendering it raw printed `crm.timeline.created`
 * on the screen; resolving it first is the whole difference.
 */
const entryBody = (_: Translator, row: AnyRow): string => {
  const body = String(row.body ?? '')
  if (body && _.resolves(body)) return _(body)
  if (body) return body
  const fallback = `crm.timeline.${String(row.eventType ?? '')}`
  return _.resolves(fallback) ? _(fallback) : String(row.eventType ?? '—')
}
const priority = (_: Translator, value: unknown) => {
  const key = `crm_backend.priority.${String(value ?? '1')}`
  return _.resolves(key) ? _(key) : String(value ?? '—')
}
const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}
const state = (_: Translator, value: unknown) => {
  const raw = String(value ?? '')
  return badge(
    local(_, 'terminal', raw),
    raw === 'won' ? 'positive' : raw === 'lost' ? 'danger' : 'neutral',
    raw,
  )
}

export const permissionScreen = (_: Translator, frame: Frame): TemplateResult => (
  <RecordScreen
    translator={_}
    title={_('crm_backend.permission.title')}
    subtitle={_('crm_backend.permission.hint')}
    frame={frame}
    body={emptyState(_('crm_backend.permission.title'), _('crm_backend.permission.hint'))}
  />
)

export type CaseDetailControls = {
  stage?: JSXChild
  /** Opportunity stages, offered only while confirming a conversion. */
  convertStage?: JSXChild
  mergeSource?: JSXChild
  assignTeam?: JSXChild
  assignUser?: JSXChild
  activityAssignee?: JSXChild
  quotationProduct?: JSXChild
}

/**
 * The step before a lead becomes an opportunity.
 *
 * Converting changes what the record is, and the record keeps its identity while
 * it happens: the same case, the same partner, the same timeline and the same
 * owner. A one-click action in the bar could neither say that nor ask which
 * stage the opportunity should open in, so it asks here instead.
 */
export const caseConvertModal = (
  _: Translator,
  row: AnyRow,
  options: { action: string; cancelHref: string; control?: JSXChild; errors?: string[] },
): TemplateResult =>
  modalForm({
    id: 'crm-case-convert',
    title: _('crm_backend.convert.title'),
    description: _('crm_backend.convert.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('crm_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'crm-case-convert-form',
      scope: 'crm-case-convert',
      action: options.action,
      cancelHref: options.cancelHref,
      cancelLabel: _('crm_backend.action.cancel'),
      errors: options.errors,
      hidden: { action: 'convert', expectedVersion: String(row.version ?? 0) },
      fields: [
        {
          name: 'stageId',
          label: _('crm_backend.convert.stage'),
          required: true,
          control: options.control,
        },
        {
          // The checkbox is checked again on the server. A required attribute
          // is a hint to a browser, not a condition the record was converted
          // under.
          name: 'confirm',
          label: _('crm_backend.convert.confirm'),
          type: 'checkbox',
          required: true,
          span: 'full',
          help: _('crm_backend.convert.confirmText'),
        },
      ],
      submit: _('crm_backend.action.convert'),
      submitVariant: 'primary',
    },
  })

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
    quotations?: AnyRow[]
    controls?: CaseDetailControls
    errors?: string[]
    tab?: string
    locale?: string
  },
): TemplateResult => {
  const sales = (row.salesDetail as AnyRow | null) ?? null
  const timeline = (row.timeline as AnyRow[] | undefined) ?? []
  const messages = (row.messages as AnyRow[] | undefined) ?? []
  const attachments = (row.attachments as AnyRow[] | undefined) ?? []
  const activities = (row.activities as AnyRow[] | undefined) ?? []
  const meetings = (row.meetings as AnyRow[] | undefined) ?? []
  const tags = (row.tags as AnyRow[] | undefined) ?? []
  const quotations = options.quotations ?? []
  const controls = options.controls ?? {}
  const activeTab = options.tab ?? 'overview'
  const basePath = `/admin/crm/cases/${encodeURIComponent(String(row.id))}`
  const href = (tab: string) => localized(`${basePath}?tab=${tab}`, options.locale ?? '')
  const endpoint = localized(basePath, options.locale ?? '')
  const commandForm = (
    action: string,
    fields: FormField[],
    submit: string,
    variant: 'primary' | 'secondary' | 'destructive' = 'secondary',
    extra: Record<string, string> = {},
  ) => (
    <Surface
      body={
        <RecordForm
          action={endpoint}
          hidden={{ action, expectedVersion: String(row.version ?? 0), ...extra }}
          fields={fields}
          submit={submit}
          submitVariant={variant}
        />
      }
    />
  )

  const activityRows = activities.filter((item) => !item.doneAt && !item.canceledAt)
  const activityHistory = activities.filter((item) => item.doneAt || item.canceledAt)

  const salesTab = stack([
    <DefinitionList
      title={_('crm_backend.case.tab.sales')}
      items={[
        {
          key: 'revenue',
          term: _('crm_backend.field.expectedRevenue'),
          value: formatMoney(_, sales?.expectedRevenue ?? 0, row.currency),
        },
        {
          key: 'recurring',
          term: _('crm_backend.field.recurringRevenue'),
          value: formatMoney(_, sales?.recurringRevenue ?? 0, row.currency),
        },
        {
          key: 'probability',
          term: _('crm_backend.field.probability'),
          value: `${String(sales?.probability ?? 0)}%`,
        },
        {
          key: 'closing',
          term: _('crm_backend.field.expectedClosing'),
          value: when(sales?.expectedClosing),
        },
        {
          key: 'forecast',
          term: _('crm_backend.field.forecastCategory'),
          value: String(sales?.forecastCategory ?? '—'),
        },
        ...(sales?.lostReason
          ? [{ key: 'lostReason', term: _('crm_backend.field.lostReason'), value: String(sales.lostReason) }]
          : []),
      ]}
    />,
    ...(quotations.length
      ? [
          <Section
            title={_('crm_backend.quotation.title')}
            body={dataTable(_, {
              rows: quotations,
              id: (item) => String(item.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.quotation.reference'),
                  priority: 'primary',
                  cell: (item) =>
                    linkButton({
                      // A quotation lives under /quotations until it is
                      // confirmed, which is the same split sale_backend uses.
                      href: localized(
                        `${
                          ['draft', 'sent'].includes(String(item.state))
                            ? '/admin/sales/quotations'
                            : '/admin/sales/orders'
                        }/${String(item.id)}`,
                        options.locale ?? '',
                      ),
                      label: String(item.name ?? item.id),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                { key: 'state', label: _('crm_backend.field.state'), cell: (item) => String(item.state) },
                {
                  key: 'total',
                  label: _('crm_backend.quotation.total'),
                  cell: (item) => formatMoney(_, item.amountTotal, item.currency),
                },
                { key: 'at', label: _('crm_backend.timeline.at'), cell: (item) => when(item.createdAt) },
              ],
            })}
          />,
        ]
      : []),
    ...(row.kind === 'opportunity' && options.warehouses.length
      ? [
          <Section
            title={_('crm_backend.quotation.create')}
            description={_('crm_backend.quotation.hint')}
            body={
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
                      // A quotation without a line is a quotation nobody can
                      // send, so the first line is asked for here rather than
                      // discovered as an empty order later.
                      {
                        name: 'productId',
                        label: _('crm_backend.quotation.product'),
                        required: true,
                        control: controls.quotationProduct,
                      },
                      {
                        name: 'quantity',
                        label: _('crm_backend.quotation.quantity'),
                        type: 'decimal',
                        value: '1',
                        required: true,
                      },
                      {
                        name: 'priceUnit',
                        label: _('crm_backend.quotation.priceUnit'),
                        type: 'decimal',
                        placeholder: _('crm_backend.quotation.priceFromPricelist'),
                      },
                      { name: 'notes', label: _('crm_backend.field.note'), type: 'textarea', span: 'full' },
                    ]}
                    submit={_('crm_backend.quotation.create')}
                    submitVariant="primary"
                  />
                }
              />
            }
          />,
        ]
      : []),
  ])

  const activityTable = (items: AnyRow[], withActions: boolean) =>
    dataTable(_, {
      rows: items,
      id: (item) => String(item.id),
      columns: [
        {
          key: 'summary',
          label: _('crm_backend.field.name'),
          priority: 'primary',
          cell: (item) => String(item.summary ?? '—'),
        },
        { key: 'due', label: _('crm_backend.field.dueAt'), cell: (item) => when(item.dueDate) },
        {
          key: 'state',
          label: _('crm_backend.field.state'),
          cell: (item) =>
            item.doneAt
              ? badge(_('crm_backend.activity.done'), 'positive', 'done')
              : item.canceledAt
                ? badge(_('crm_backend.activity.cancelled'), 'neutral', 'cancelled')
                : badge(_('crm_backend.activity.open'), 'info', 'open'),
        },
        ...(withActions
          ? [
              {
                key: 'actions',
                label: _('crm_backend.field.actions'),
                cell: (item: AnyRow) => (
                  <>
                    <RecordForm
                      action={endpoint}
                      layout="inline"
                      hidden={{ action: 'completeActivity', activityId: String(item.id) }}
                      fields={[]}
                      submit={_('crm_backend.activity.complete')}
                      submitVariant="secondary"
                      submitSize="compact"
                    />
                    <RecordForm
                      action={endpoint}
                      layout="inline"
                      hidden={{ action: 'cancelActivity', activityId: String(item.id) }}
                      fields={[]}
                      submit={_('crm_backend.activity.cancel')}
                      submitVariant="tertiary"
                      submitSize="compact"
                    />
                  </>
                ),
              },
            ]
          : []),
      ],
    })

  const activitiesTab = stack([
    <Section
      title={_('crm_backend.activity.open')}
      body={activityRows.length ? activityTable(activityRows, true) : empty(_)}
    />,
    ...(meetings.length
      ? [
          <Section
            title={_('crm_backend.activity.meetings')}
            body={dataTable(_, {
              rows: meetings,
              id: (item) => String(item.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.field.name'),
                  priority: 'primary',
                  cell: (item) => String(item.name ?? '—'),
                },
                {
                  key: 'start',
                  label: _('crm_backend.field.dueAt'),
                  cell: (item) => when(item.startAt ?? item.startDate),
                },
              ],
            })}
          />,
        ]
      : []),
    <Section
      title={_('crm_backend.activity.schedule')}
      body={
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
                  control: controls.activityAssignee,
                },
                { name: 'summary', label: _('crm_backend.field.name'), required: true },
                { name: 'dueDate', label: _('crm_backend.field.dueAt'), type: 'date', required: true },
                { name: 'note', label: _('crm_backend.field.note'), type: 'textarea', span: 'full' },
              ]}
              submit={_('crm_backend.activity.schedule')}
              submitVariant="secondary"
            />
          }
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
    ...(activityHistory.length
      ? [<Section title={_('crm_backend.activity.history')} body={activityTable(activityHistory, false)} />]
      : []),
  ])

  const timelineTab = timeline.length
    ? dataTable(_, {
        rows: timeline,
        id: (item) => String(item.id),
        columns: [
          { key: 'at', label: _('crm_backend.timeline.at'), cell: (item) => when(item.occurredAt) },
          {
            key: 'event',
            label: _('crm_backend.timeline.event'),
            priority: 'primary',
            cell: (item) => entryBody(_, item),
          },
          {
            key: 'kind',
            label: _('crm_backend.field.kind'),
            cell: (item) => local(_, 'timeline', item.eventType),
          },
        ],
      })
    : empty(_)

  const overviewTab = stack([
    ...(options.duplicates.length
      ? [
          // Duplicate detection has always run on this page; nothing ever
          // rendered what it found.
          <Section
            title={_('crm_backend.duplicates.title')}
            description={_('crm_backend.duplicates.hint')}
            body={dataTable(_, {
              rows: options.duplicates,
              id: (item) => String(item.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.field.name'),
                  priority: 'primary',
                  cell: (item) =>
                    linkButton({
                      href: localized(`/admin/crm/cases/${String(item.id)}`, options.locale ?? ''),
                      label: String(item.name),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'contact',
                  label: _('crm_backend.field.email'),
                  cell: (item) => String(item.email ?? item.phone ?? '—'),
                },
                {
                  key: 'stage',
                  label: _('crm_backend.field.stage'),
                  cell: (item) => String(item.stageName ?? '—'),
                },
                {
                  key: 'merge',
                  label: _('crm_backend.field.actions'),
                  cell: (item: AnyRow) => (
                    <RecordForm
                      action={endpoint}
                      layout="inline"
                      hidden={{
                        action: 'merge',
                        expectedVersion: String(row.version ?? 0),
                        sourceId: String(item.id),
                      }}
                      fields={[]}
                      submit={_('crm_backend.merge.absorb')}
                      submitVariant="secondary"
                      submitSize="compact"
                    />
                  ),
                },
              ],
            })}
          />,
        ]
      : []),
    <DefinitionList
      title={_('crm_backend.case.detail')}
      items={[
        { key: 'kind', term: _('crm_backend.field.kind'), value: local(_, 'kind', row.kind) },
        { key: 'stage', term: _('crm_backend.field.stage'), value: String(row.stageName ?? '—') },
        { key: 'partner', term: _('crm_backend.field.partner'), value: String(row.partnerName ?? '—') },
        { key: 'assignee', term: _('crm_backend.field.assignee'), value: String(row.assigneeName ?? '—') },
        { key: 'team', term: _('crm_backend.field.team'), value: String(row.teamName ?? '—') },
        { key: 'priority', term: _('crm_backend.field.priority'), value: priority(_, row.priority) },
        {
          key: 'tags',
          term: _('crm_backend.field.tags'),
          value: tags.length ? tags.map((tag) => String(tag.name)).join(', ') : '—',
        },
        ...(row.closedAt
          ? [{ key: 'closedAt', term: _('crm_backend.field.closedAt'), value: when(row.closedAt) }]
          : []),
      ]}
    />,
    <Surface
      body={
        <RecordForm
          action={endpoint}
          hidden={{ action: 'save', expectedVersion: String(row.version ?? 0), kind: String(row.kind) }}
          fields={options.fields}
          errors={options.errors}
          submit={_('crm_backend.action.save')}
          submitVariant="primary"
        />
      }
    />,
    <Section
      title={_('crm_backend.action.move')}
      body={commandForm(
        'move',
        [
          {
            name: 'stageId',
            label: _('crm_backend.field.stage'),
            value: String(row.stageId),
            required: true,
            control: controls.stage,
          },
        ],
        _('crm_backend.action.move'),
      )}
    />,
    // Assigning and merging were both wired in the route and reachable from
    // nowhere; these are the forms that call them.
    <Section
      title={_('crm_backend.assign.title')}
      description={_('crm_backend.assign.hint')}
      body={commandForm(
        'assign',
        [
          { name: 'teamId', label: _('crm_backend.field.team'), control: controls.assignTeam },
          { name: 'assigneeUserId', label: _('crm_backend.field.assignee'), control: controls.assignUser },
        ],
        _('crm_backend.assign.submit'),
      )}
    />,
    <Section
      title={_('crm_backend.merge.title')}
      description={_('crm_backend.merge.hint')}
      body={commandForm(
        'merge',
        [
          {
            name: 'sourceId',
            label: _('crm_backend.merge.source'),
            required: true,
            control: controls.mergeSource,
          },
        ],
        _('crm_backend.merge.submit'),
        'destructive',
      )}
    />,
    ...(row.kind === 'opportunity' && row.terminalState === 'open'
      ? [
          // Marking a case lost always recorded "not_specified", because the
          // action bar posts no reason and nothing asked for one.
          <Section
            title={_('crm_backend.action.lost')}
            body={commandForm(
              'lost',
              [
                {
                  name: 'lostReason',
                  label: _('crm_backend.field.lostReason'),
                  required: true,
                  span: 'full',
                },
              ],
              _('crm_backend.action.lost'),
              'destructive',
            )}
          />,
        ]
      : []),
  ])

  const main =
    activeTab === 'sales'
      ? salesTab
      : activeTab === 'activities'
        ? activitiesTab
        : activeTab === 'timeline'
          ? timelineTab
          : overviewTab
  const actions = [
    { value: 'refreshScore', label: _('crm_backend.action.refreshScore'), variant: 'secondary' as const },
    // "Convert" is not here either: it changes what the record is, and the
    // action bar has nowhere to say so or to ask which stage the opportunity
    // opens in. Its confirmation is a step of its own.
    // "Lost" is not here: it needs a reason, and a bare action button could only
    // ever send "not_specified". Its form lives on the overview tab.
    ...(row.kind === 'opportunity' && row.terminalState === 'open'
      ? [{ value: 'won', label: _('crm_backend.action.won'), variant: 'primary' as const }]
      : []),
  ]
  return (
    <RecordScreen
      translator={_}
      title={String(row.name)}
      subtitle={`${String(row.partnerName ?? '—')} · ${String(row.stageName ?? '—')}`}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={local(_, 'kind', row.kind)}
          title={String(row.name)}
          subtitle={`${String(row.partnerName ?? '—')} · ${String(row.stageName ?? '—')}`}
          imageFallback={icon('target')}
          badges={[state(_, row.terminalState)]}
          summary={[
            { id: 'priority', label: _('crm_backend.field.priority'), value: priority(_, row.priority) },
            {
              id: 'revenue',
              label: _('crm_backend.field.expectedRevenue'),
              value: formatMoney(_, sales?.expectedRevenue ?? 0, row.currency),
            },
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
          controller={
            <>
              {row.kind === 'lead'
                ? linkButton({
                    href: localized(`${basePath}?tab=${activeTab}&modal=convert`, options.locale ?? ''),
                    label: _('crm_backend.action.convert'),
                    variant: 'primary',
                  })
                : null}
              <RecordActions
                action={endpoint}
                // Without this the route falls back to the version it just read,
                // and the compare-and-set behind every one of these actions can
                // never fail. A stale tab would silently win.
                hidden={{ expectedVersion: String(row.version ?? 0) }}
                actions={actions}
              />
            </>
          }
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
                  uploadAction={localized(`${basePath}/attachments`, options.locale ?? '')}
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
                  ? messages.map((item) => (
                      <Surface
                        padding="compact"
                        body={stack([when(item.createdAt), String(item.body)], 'compact')}
                      />
                    ))
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
