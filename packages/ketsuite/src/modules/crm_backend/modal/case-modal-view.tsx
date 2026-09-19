import {
  ActionGroup,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  FileUpload,
  LinkButton,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig, RelationSelectLabels } from '@ketvietlab/design-system'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordCommandForm,
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { CRM_RECORD_MODAL_LABELS } from '../../crm/record-modal-labels.ts'

type Row = Record<string, unknown>
export type CaseModalData = {
  record: Row
  stages: Row[]
  teams: Row[]
  users: Row[]
  tags: Row[]
  types: Row[]
  plans: Row[]
  warehouses: Row[]
  duplicates: Row[]
  quotations: Row[]
  productUoms: Record<string, string>
  permissions: Record<string, boolean>
  partnerIntent: boolean
  partner: Row | null
  lang: 'vi' | 'en'
}
type Context = RecordModalContext<CaseModalData>
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()
const uuid = () => crypto.randomUUID()
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`crm_backend.${key}`)
const can = (c: Context, action: string) => c.data.permissions[action] === true
const options = (items: Row[]) =>
  items.map((item) => ({ value: String(item.id), label: String(item.name ?? item.id) }))
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: `crm-case-${c.dialog?.name ?? c.tab}-${props.name}`,
  value:
    props.type === 'checkbox'
      ? c.draftChecked(props.name, '1', props.value === true)
      : c.draft(props.name, String(props.value ?? '')),
  error: c.fieldError(props.name),
})
const submit = (c: Context, command: string, label = t(c, 'action.save')) => (
  <Button type="submit" name="__command" value={command} label={label} variant="primary" disabled={c.busy} />
)
const trigger = (c: Context, dialog: string, label: string) => (
  <RecordDialogTrigger dialog={dialog}>
    <Button label={label} variant="secondary" disabled={c.busy} />
  </RecordDialogTrigger>
)
const form = (c: Context, command: string, fields: FieldProps[], label?: string) => (
  <RecordModalForm kind={c.kind} command={command} fields={fields} actions={[submit(c, command, label)]} />
)
const relation = (
  c: Context,
  name: string,
  label: string,
  listFunction: string,
  choices: Row[] = [],
  value: unknown = '',
  listInput?: Row,
  required = false,
  disabled = false,
  multiple = false,
): FieldProps => {
  const base = field(c, { name, label, value: String(value ?? ''), type: 'select', required, disabled })
  const keys = [
    'choose',
    'search',
    'more',
    'noRecords',
    'loading',
    'loadError',
    'close',
    'select',
    'create',
    'edit',
    'save',
    'cancel',
    'remove',
    'confirmRemove',
    'retry',
    'clear',
    'chosen',
  ]
  const labels = Object.fromEntries(
    keys.map((key) => [key, c.t(`backend.relation.${key}`)]),
  ) as unknown as RelationSelectLabels
  const config: RelationSelectConfig = {
    name,
    ariaLabel: label,
    required,
    disabled,
    value: String(base.value || '') || null,
    multiple,
    ...(multiple
      ? {
          values: String(base.value || '')
            .split(',')
            .filter(Boolean),
        }
      : {}),
    options: options(choices),
    labels: { ...labels, dialogTitle: label },
    manager: { listFunction, listInput },
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id, config }) }
}
const select = (
  c: Context,
  name: string,
  label: string,
  choices: Row[],
  value: unknown = '',
  required = false,
) =>
  field(c, {
    name,
    label,
    type: 'select',
    value: String(value ?? ''),
    required,
    options: [{ value: '', label: '—' }, ...options(choices)],
  })
const caseFields = (c: Context): FieldProps[] => {
  const r = c.data.record
  const sales = (r.salesDetail ?? {}) as Row
  const kind = c.creating ? c.state('kind', c.draft('kind', String(r.kind ?? 'lead'))) : String(r.kind)
  const kindOptions = ['lead', 'opportunity'].map((value) => ({ value, label: c.t(`crm.kind.${value}`) }))
  const kindField = field(c, {
    name: 'kind',
    label: t(c, 'field.kind'),
    value: kind,
    type: 'select',
    options: kindOptions,
    disabled: !c.creating,
  })
  const selectedTags = rows(r.tags).map((tag) => String(tag.id))
  return [
    field(c, {
      name: 'name',
      label: t(c, 'field.name'),
      value: String(r.name ?? ''),
      required: true,
      span: 'full',
    }),
    {
      ...kindField,
      ...(c.creating
        ? {
            control: recordStateSelectControl({
              id: kindField.id,
              name: 'kind',
              state: 'kind',
              value: kind,
              options: kindOptions,
              required: true,
            }),
          }
        : {}),
    },
    ...(c.creating
      ? [
          select(
            c,
            'stageId',
            t(c, 'field.stage'),
            c.data.stages.filter(
              (stage) => (stage.allowedKinds as string[]).includes(kind) && stage.terminalState === 'open',
            ),
            r.stageId,
          ),
        ]
      : []),
    {
      ...relation(
        c,
        'partnerId',
        t(c, 'field.partner'),
        'partner.listPartners',
        r.partnerId ? [{ id: r.partnerId, name: r.partnerName ?? c.data.partner?.name ?? r.partnerId }] : [],
        r.partnerId,
        undefined,
        c.data.partnerIntent,
      ),
      required: c.data.partnerIntent,
    },
    field(c, {
      name: 'utmSource',
      label: t(c, 'field.source'),
      value: String(r.utmSource ?? ''),
      type: 'select',
      options: [
        { value: '', label: '—' },
        ...[
          ...new Set([
            'marketplace',
            'social',
            'website',
            'support',
            'referral',
            ...(r.utmSource ? [String(r.utmSource)] : []),
          ]),
        ].map((value) => ({
          value,
          label: ['marketplace', 'social', 'website', 'support', 'referral'].includes(value)
            ? t(c, `source.${value}`)
            : value,
        })),
      ],
    }),
    ...['contactName', 'email', 'phone'].map((name) =>
      field(c, {
        name,
        label: t(c, `field.${name}`),
        value: String(r[name] ?? ''),
        type: name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text',
      }),
    ),
    relation(
      c,
      'teamId',
      t(c, 'field.team'),
      'crm.team.list',
      c.data.teams,
      r.teamId,
      undefined,
      false,
      !c.creating,
    ),
    relation(
      c,
      'assigneeUserId',
      t(c, 'field.assignee'),
      'user.listUsers',
      c.data.users,
      r.assigneeUserId,
      undefined,
      false,
      !c.creating,
    ),
    field(c, {
      name: 'priority',
      label: t(c, 'field.priority'),
      type: 'select',
      value: String(r.priority ?? '1'),
      options: ['0', '1', '2', '3'].map((value) => ({ value, label: t(c, `priority.${value}`) })),
    }),
    {
      ...relation(
        c,
        'tagIds',
        t(c, 'field.tags'),
        'crm.tag.list',
        c.data.tags,
        selectedTags.join(','),
        undefined,
        false,
        false,
        true,
      ),
      span: 'full',
    },
    ...['expectedRevenue', 'probability', 'expectedClosing'].map((name) =>
      field(c, {
        name,
        label: t(c, `field.${name}`),
        type: name === 'expectedClosing' ? 'date' : 'decimal',
        value: String(sales[name] ?? (name === 'expectedClosing' ? '' : '0')),
      }),
    ),
    field(c, {
      name: 'description',
      label: t(c, 'field.description'),
      type: 'textarea',
      value: String(r.description ?? ''),
      required: c.data.partnerIntent,
      span: 'full',
    }),
  ]
}
const details = (c: Context, items: Row[], columns: { key: string; label: string }[]) => (
  <DataTable
    emptyTitle={t(c, 'empty.title')}
    emptyMessage={t(c, 'empty.hint')}
    rows={items}
    id={(row) => String(row.id)}
    columns={columns.map((column) => ({ ...column, cell: (row: Row) => String(row[column.key] ?? '—') }))}
  />
)
const overview = (c: Context) => (
  <Stack
    items={[
      can(c, 'case.save') ? (
        <RecordModalForm
          id="crm-case-form"
          kind={c.kind}
          command={c.creating ? 'create' : 'save'}
          fields={caseFields(c)}
        />
      ) : (
        <DescriptionList
          items={['name', 'partnerName', 'stageName', 'assigneeName', 'description'].map((key) => ({
            id: key,
            label: t(
              c,
              `field.${({ partnerName: 'partner', stageName: 'stage', assigneeName: 'assignee' } as Record<string, string>)[key] ?? key}`,
            ),
            value: String(c.data.record[key] ?? '—'),
          }))}
        />
      ),
      ...(!c.creating
        ? [
            <ActionGroup
              actions={[
                ...(can(c, 'case.move') ? [trigger(c, 'move', t(c, 'action.move'))] : []),
                ...(can(c, c.data.record.assigneeUserId ? 'case.reassign' : 'case.assign')
                  ? [trigger(c, 'assign', t(c, 'assign.title'))]
                  : []),
                ...(can(c, 'case.merge') ? [trigger(c, 'merge', t(c, 'merge.title'))] : []),
              ]}
            />,
            ...(c.data.duplicates.length
              ? [
                  <Section
                    title={t(c, 'duplicates.title')}
                    body={details(c, c.data.duplicates, [
                      { key: 'name', label: t(c, 'field.name') },
                      { key: 'email', label: t(c, 'field.email') },
                    ])}
                  />,
                ]
              : []),
          ]
        : []),
    ]}
  />
)
const salesTab = (c: Context) => (
  <Stack
    items={[
      <DescriptionList
        items={['expectedRevenue', 'probability', 'expectedClosing', 'lostReason'].map((key) => ({
          id: key,
          label: t(c, `field.${key}`),
          value: String(((c.data.record.salesDetail ?? {}) as Row)[key] ?? '—'),
        }))}
      />,
      <Section
        title={t(c, 'quotation.title')}
        body={
          <DataTable
            emptyTitle={t(c, 'empty.title')}
            emptyMessage={t(c, 'empty.hint')}
            rows={c.data.quotations}
            id={(row) => String(row.id)}
            columns={[
              {
                key: 'name',
                label: t(c, 'quotation.reference'),
                cell: (row) => (
                  <LinkButton
                    variant="tertiary"
                    label={String(row.name ?? row.id)}
                    href={`/admin/sales/${['draft', 'sent'].includes(String(row.state)) ? 'quotations' : 'orders'}/${encodeURIComponent(String(row.id))}?lang=${c.data.lang}`}
                  />
                ),
              },
              {
                key: 'amountTotal',
                label: t(c, 'quotation.total'),
                cell: (row) => new Intl.NumberFormat(c.data.lang).format(Number(row.amountTotal ?? 0)),
              },
              { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
            ]}
          />
        }
      />,
      ...(c.data.record.kind === 'opportunity' && can(c, 'quotation')
        ? [trigger(c, 'quotation', t(c, 'quotation.create'))]
        : []),
    ]}
  />
)
const activitiesTab = (c: Context) => (
  <Stack
    items={[
      <ActionGroup
        actions={[
          ...(can(c, 'activity.schedule') ? [trigger(c, 'activity', t(c, 'activity.schedule'))] : []),
          ...(can(c, 'plan.apply') ? [trigger(c, 'plan', t(c, 'planner.plans'))] : []),
        ]}
      />,
      <DataTable
        emptyTitle={t(c, 'empty.title')}
        emptyMessage={t(c, 'empty.hint')}
        rows={rows(c.data.record.activities)}
        id={(row) => String(row.id)}
        columns={[
          { key: 'summary', label: t(c, 'field.name'), cell: (row) => String(row.summary ?? '') },
          { key: 'dueDate', label: t(c, 'field.dueAt'), cell: (row) => String(row.dueDate ?? '') },
          {
            key: 'state',
            label: t(c, 'field.state'),
            cell: (row) =>
              String(
                row.doneAt
                  ? t(c, 'activity.done')
                  : row.canceledAt
                    ? t(c, 'activity.cancelled')
                    : t(c, 'activity.open'),
              ),
          },
          {
            key: 'actions',
            label: t(c, 'field.actions'),
            cell: (row) => (
              <ActionGroup
                actions={['complete', 'cancel']
                  .filter((action) => !row.doneAt && !row.canceledAt && can(c, `activity.${action}`))
                  .map((action) => (
                    <RecordDialogTrigger dialog={action} id={String(row.id)}>
                      <Button label={t(c, `activity.${action}`)} variant="secondary" />
                    </RecordDialogTrigger>
                  ))}
              />
            ),
          },
        ]}
      />,
      <Section
        title={t(c, 'activity.meetings')}
        body={details(
          c,
          rows(c.data.record.meetings).map((row) => ({ ...row, start: row.startAt ?? row.startDate })),
          [
            { key: 'name', label: t(c, 'field.name') },
            { key: 'start', label: t(c, 'field.dueAt') },
          ],
        )}
      />,
    ]}
  />
)
const timelineTab = (c: Context) => (
  <Stack
    items={[
      details(
        c,
        rows(c.data.record.timeline).map((row) => ({
          ...row,
          event: `${row.eventType === 'interaction' ? `${t(c, `interaction.channel.${(row.metadata as Row)?.channel}`)} · ${t(c, `interaction.outcome.${(row.metadata as Row)?.outcome}`)} · ` : ''}${c.t(String(row.body || `crm.timeline.${row.eventType}`))}${(row.metadata as Row)?.reason ? ` · ${(row.metadata as Row).reason}` : ''}`,
        })),
        [
          { key: 'occurredAt', label: t(c, 'timeline.at') },
          { key: 'event', label: t(c, 'timeline.event') },
        ],
      ),
      <Section
        title={t(c, 'messages.title')}
        body={details(c, rows(c.data.record.messages), [
          { key: 'createdAt', label: t(c, 'timeline.at') },
          { key: 'body', label: t(c, 'field.message') },
        ])}
      />,
      ...(can(c, 'case.addMessage')
        ? [
            form(
              c,
              'message',
              [
                field(c, {
                  name: 'body',
                  label: t(c, 'field.message'),
                  type: 'textarea',
                  required: true,
                  span: 'full',
                }),
              ],
              t(c, 'action.addNote'),
            ),
          ]
        : []),
      <Section
        title={t(c, 'attachments.title')}
        body={
          <Stack
            items={rows(c.data.record.attachments).map((row) => (
              <LinkButton
                label={String(row.name)}
                href={`/files/${encodeURIComponent(String(row.id))}`}
                variant="tertiary"
              />
            ))}
          />
        }
      />,
      ...(can(c, 'upload')
        ? [
            <RecordActionForm kind={c.kind} command="upload">
              <FileUpload
                id="crm-case-attachment"
                name="attachment"
                label={t(c, 'attachments.choose')}
                required
                error={c.fieldError('attachment')}
              />
              {submit(c, 'upload', t(c, 'attachments.upload'))}
            </RecordActionForm>,
          ]
        : []),
    ]}
  />
)
const versioned = (c: Context) => ({
  id: c.id,
  expectedVersion: Number(c.data.record.version),
  idempotencyKey: uuid(),
})
const saveInput = (f: FormData, c: Context): Row => ({
  id: c.creating ? uuid() : c.id,
  ...(!c.creating
    ? {
        stageId: c.data.record.stageId,
        ...(c.data.record.teamId ? { teamId: c.data.record.teamId } : {}),
        ...(c.data.record.assigneeUserId ? { assigneeUserId: c.data.record.assigneeUserId } : {}),
      }
    : {}),
  kind: c.creating ? text(f, 'kind') : c.data.record.kind,
  ...Object.fromEntries(
    [
      'name',
      'contactName',
      'email',
      'phone',
      'priority',
      'description',
      'utmSource',
      'expectedRevenue',
      'probability',
    ].map((name) => [name, text(f, name)]),
  ),
  ...Object.fromEntries(
    ['partnerId', 'teamId', 'assigneeUserId', 'expectedClosing', ...(c.creating ? ['stageId'] : [])]
      .filter((name) => text(f, name))
      .map((name) => [name, text(f, name)]),
  ),
  tagIds: text(f, 'tagIds')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  ...(!c.creating ? { expectedVersion: Number(c.data.record.version) } : {}),
  idempotencyKey: uuid(),
})
const simpleDialog = (title: string, command: string, fields: (c: Context) => FieldProps[]) => ({
  title: (c: Context) => t(c, title),
  view: (c: Context) => form(c, command, fields(c), t(c, title)),
})
export const caseModalDefinition: RecordModalDefinition<CaseModalData> = {
  kind: 'crm.case',
  size: 'large',
  fixedHeight: 'min(48rem, calc(100dvh - var(--kv-space-12)))',
  labels: () => CRM_RECORD_MODAL_LABELS[lang()],
  context: {
    fn: 'crm.case.modalContext',
    input: (id, creating) => {
      const query =
        typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)
      return {
        ...(creating
          ? Object.fromEntries(
              ['kind', 'stageId', 'partnerId']
                .filter((key) => query.has(key))
                .map((key) => [key, query.get(key)]),
            )
          : { id }),
        locale: lang(),
      }
    },
  },
  title: (c) => (c.creating ? t(c, 'action.create') : String(c.data.record.name)),
  status: (c) => (c.creating ? '' : <Badge label={c.t(`crm.terminal.${c.data.record.terminalState}`)} />),
  body: (c) => (c.creating ? overview(c) : ''),
  tabs: [
    { id: 'overview', label: (c) => t(c, 'case.tab.overview'), visible: (c) => !c.creating, view: overview },
    { id: 'sales', label: (c) => t(c, 'case.tab.sales'), visible: (c) => !c.creating, view: salesTab },
    {
      id: 'activities',
      label: (c) => t(c, 'case.tab.activities'),
      visible: (c) => !c.creating,
      view: activitiesTab,
    },
    {
      id: 'timeline',
      label: (c) => t(c, 'case.tab.timeline'),
      visible: (c) => !c.creating,
      view: timelineTab,
    },
  ],
  actions: (c) => (
    <ActionGroup
      actions={[
        ...((c.creating || c.tab === 'overview') && can(c, 'case.save')
          ? [
              <Button
                type="submit"
                form="crm-case-form"
                label={t(c, c.creating ? 'action.create' : 'action.save')}
                variant="primary"
                disabled={c.busy}
              />,
            ]
          : []),
        ...(!c.creating && c.data.record.kind === 'lead' && can(c, 'case.convertLead')
          ? [trigger(c, 'convert', t(c, 'action.convert'))]
          : []),
        ...(!c.creating &&
        c.data.record.kind === 'opportunity' &&
        c.data.record.terminalState === 'open' &&
        (can(c, 'case.markWon') || can(c, 'case.markLost'))
          ? [trigger(c, 'close', t(c, 'close.title'))]
          : []),
        ...(!c.creating && can(c, 'case.logInteraction')
          ? [trigger(c, 'interaction', t(c, 'interaction.title'))]
          : []),
        ...(!c.creating && can(c, 'case.refreshScore')
          ? [
              <RecordCommandForm kind={c.kind} id="crm-case-score-form" />,
              <Button
                type="submit"
                form="crm-case-score-form"
                name="__command"
                value="refreshScore"
                label={t(c, 'action.refreshScore')}
                variant="secondary"
                disabled={c.busy}
              />,
            ]
          : []),
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.close')} variant="secondary" />
        </RecordCloseTrigger>,
      ]}
    />
  ),
  dialogs: {
    interaction: simpleDialog('interaction.title', 'interaction', (c) => [
      select(
        c,
        'channel',
        t(c, 'interaction.channel'),
        ['phone', 'email', 'chat', 'meeting', 'other'].map((id) => ({
          id,
          name: t(c, `interaction.channel.${id}`),
        })),
        'phone',
        true,
      ),
      select(
        c,
        'outcome',
        t(c, 'interaction.outcome'),
        ['reached', 'attempted', 'unreachable'].map((id) => ({
          id,
          name: t(c, `interaction.outcome.${id}`),
        })),
        '',
        true,
      ),
      field(c, { name: 'note', label: t(c, 'field.note'), type: 'textarea' }),
    ]),
    move: simpleDialog('action.move', 'move', (c) => [
      select(
        c,
        'stageId',
        t(c, 'field.stage'),
        c.data.stages.filter((stage) =>
          (stage.allowedKinds as string[]).includes(String(c.data.record.kind)),
        ),
        c.data.record.stageId,
        true,
      ),
    ]),
    assign: {
      title: (c) => t(c, 'assign.title'),
      view: (c) =>
        form(c, c.data.record.assigneeUserId ? 'reassign' : 'assign', [
          relation(c, 'teamId', t(c, 'field.team'), 'crm.team.list', c.data.teams, c.data.record.teamId),
          relation(
            c,
            'assigneeUserId',
            t(c, 'field.assignee'),
            'user.listUsers',
            c.data.users,
            c.data.record.assigneeUserId,
          ),
        ]),
    },
    merge: simpleDialog('merge.title', 'merge', (c) => [
      relation(c, 'sourceId', t(c, 'merge.source'), 'crm.case.options', [], '', {
        kind: c.data.record.kind,
        excludeId: c.id,
      }),
    ]),
    convert: simpleDialog('convert.title', 'convert', (c) => [
      select(
        c,
        'stageId',
        t(c, 'convert.stage'),
        c.data.stages.filter(
          (stage) =>
            (stage.allowedKinds as string[]).includes('opportunity') && stage.terminalState === 'open',
        ),
        '',
        true,
      ),
      field(c, {
        name: 'expectedRevenue',
        label: t(c, 'field.expectedRevenue'),
        type: 'decimal',
        required: true,
        value: String(((c.data.record.salesDetail ?? {}) as Row).expectedRevenue ?? '0'),
      }),
      field(c, {
        name: 'expectedClosing',
        label: t(c, 'field.expectedClosing'),
        type: 'date',
        required: true,
      }),
      field(c, { name: 'confirm', label: t(c, 'convert.confirm'), type: 'checkbox', required: true }),
    ]),
    close: {
      title: (c) => t(c, 'close.title'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          fields={[
            select(
              c,
              'lostReasonCode',
              t(c, 'close.lostReasonCode'),
              ['budget', 'fit', 'competitor', 'no_need', 'other'].map((id) => ({
                id,
                name: t(c, `close.lostReason.${id}`),
              })),
              'other',
            ),
            field(c, { name: 'closeReason', label: t(c, 'close.reason'), type: 'textarea', required: true }),
            field(c, { name: 'confirm', label: t(c, 'close.confirm'), type: 'checkbox', required: true }),
          ]}
          actions={['won', 'lost']
            .filter((state) => can(c, state === 'won' ? 'case.markWon' : 'case.markLost'))
            .map((state) => submit(c, state, t(c, `close.${state}`)))}
        />
      ),
    },
    activity: simpleDialog('activity.schedule', 'schedule', (c) => [
      select(c, 'typeId', t(c, 'activity.type'), c.data.types),
      relation(c, 'assigneeUserId', t(c, 'field.assignee'), 'user.listUsers', c.data.users),
      field(c, { name: 'summary', label: t(c, 'field.name'), required: true }),
      field(c, { name: 'dueDate', label: t(c, 'field.dueAt'), type: 'date', required: true }),
      field(c, { name: 'note', label: t(c, 'field.note'), type: 'textarea' }),
    ]),
    plan: simpleDialog('planner.plans', 'plan', (c) => [
      select(c, 'planId', t(c, 'planner.plans'), c.data.plans, '', true),
      field(c, { name: 'anchorDate', label: t(c, 'activity.anchorDate'), type: 'date', required: true }),
    ]),
    complete: simpleDialog('activity.complete', 'complete', (c) => [
      field(c, { name: 'feedback', label: t(c, 'field.note'), type: 'textarea' }),
    ]),
    cancel: simpleDialog('activity.cancel', 'cancel', (c) => [
      field(c, { name: 'feedback', label: t(c, 'field.note'), type: 'textarea' }),
    ]),
    quotation: simpleDialog('quotation.create', 'quotation', (c) => [
      select(c, 'warehouseId', t(c, 'field.warehouse'), c.data.warehouses, '', true),
      relation(c, 'productId', t(c, 'quotation.product'), 'crm_sale.sale.listQuotableProducts'),
      field(c, { name: 'quantity', label: t(c, 'quotation.quantity'), type: 'decimal', value: '1' }),
      field(c, { name: 'priceUnit', label: t(c, 'quotation.priceUnit'), type: 'decimal' }),
      field(c, { name: 'notes', label: t(c, 'field.note'), type: 'textarea' }),
    ]),
  },
  commands: {
    interaction: {
      fn: 'crm.case.logInteraction',
      input: (f, c) => ({
        ...versioned(c),
        channel: text(f, 'channel'),
        outcome: text(f, 'outcome'),
        note: text(f, 'note'),
      }),
      after: 'reload',
    },
    create: { fn: 'crm.case.save', input: saveInput, after: 'open', openTab: 'overview' },
    save: { fn: 'crm.case.save', input: saveInput, after: 'reload' },
    move: {
      fn: 'crm.case.move',
      input: (f, c) => ({ ...versioned(c), stageId: text(f, 'stageId') }),
      after: 'reload',
    },
    assign: {
      fn: 'crm.case.assign',
      input: (f, c) => ({
        ...versioned(c),
        teamId: text(f, 'teamId'),
        assigneeUserId: text(f, 'assigneeUserId'),
      }),
      after: 'reload',
    },
    reassign: {
      fn: 'crm.case.reassign',
      input: (f, c) => ({
        ...versioned(c),
        teamId: text(f, 'teamId'),
        assigneeUserId: text(f, 'assigneeUserId'),
      }),
      after: 'reload',
    },
    merge: {
      fn: 'crm.case.merge',
      input: (f, c) => ({
        targetId: c.id,
        sourceId: text(f, 'sourceId'),
        expectedTargetVersion: Number(c.data.record.version),
        idempotencyKey: uuid(),
      }),
      after: 'reload',
      confirm: (c) => t(c, 'merge.title'),
    },
    convert: {
      fn: 'crm.case.convertLead',
      input: (f, c) => ({
        ...versioned(c),
        stageId: text(f, 'stageId'),
        expectedRevenue: text(f, 'expectedRevenue'),
        expectedClosing: text(f, 'expectedClosing'),
      }),
      after: 'reload',
    },
    won: {
      fn: 'crm.case.markWon',
      input: (f, c) => ({ ...versioned(c), closeReason: text(f, 'closeReason') }),
      after: 'reload',
    },
    lost: {
      fn: 'crm.case.markLost',
      input: (f, c) => ({
        ...versioned(c),
        closeReason: text(f, 'closeReason'),
        lostReason: text(f, 'closeReason'),
        lostReasonCode: text(f, 'lostReasonCode') || 'other',
      }),
      after: 'reload',
    },
    schedule: {
      fn: 'crm.activity.schedule',
      input: (f, c) => ({
        id: uuid(),
        caseId: c.id,
        ...Object.fromEntries(
          ['typeId', 'assigneeUserId', 'summary', 'dueDate', 'note']
            .filter((key) => text(f, key))
            .map((key) => [key, text(f, key)]),
        ),
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    plan: {
      fn: 'crm.plan.apply',
      input: (f, c) => ({
        caseId: c.id,
        planId: text(f, 'planId'),
        anchorDate: text(f, 'anchorDate'),
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    complete: {
      fn: 'crm.activity.complete',
      input: (f, c) => ({
        id: c.dialog?.params.id,
        feedback: text(f, 'feedback'),
        completedDate: new Date().toISOString().slice(0, 10),
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    cancel: {
      fn: 'crm.activity.cancel',
      input: (f, c) => ({ id: c.dialog?.params.id, feedback: text(f, 'feedback'), idempotencyKey: uuid() }),
      after: 'reload',
    },
    quotation: {
      fn: 'crm_sale.sale.createQuotation',
      input: (f, c) => ({
        id: uuid(),
        caseId: c.id,
        warehouseId: text(f, 'warehouseId'),
        notes: text(f, 'notes'),
        products: text(f, 'productId')
          ? [
              {
                productId: text(f, 'productId'),
                productUomId: c.data.productUoms[text(f, 'productId')] ?? '',
                quantity: text(f, 'quantity') || '1',
                ...(text(f, 'priceUnit') ? { priceUnit: text(f, 'priceUnit') } : {}),
              },
            ]
          : [],
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    message: {
      fn: 'crm.case.addMessage',
      input: (f, c) => ({
        id: uuid(),
        caseId: c.id,
        body: text(f, 'body'),
        visibility: 'internal',
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    upload: {
      fn: 'crm.case.get',
      upload: { attachment: (_f, c) => ({ resModel: 'crm.Case', resId: c.id, public: 'false' }) },
      input: (_f, c) => ({ id: c.id }),
      after: 'reload',
    },
    refreshScore: {
      fn: 'crm.case.refreshScore',
      input: (_f, c) => ({ id: c.id, idempotencyKey: uuid() }),
      after: 'reload',
    },
  },
}
export const caseModal = createRecordModal(caseModalDefinition)
