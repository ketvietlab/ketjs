// The CRM configuration record modals, client side (KetSuite record-modal contract).
//
// Teams, stages, tags, assignment rules and score rules open their rows and their
// create action in one client-side modal each. Every view is render-pure: it reads
// the context each `crm.*.modalContext` returned and writes design-system markup.
// The runtime owns reading, submitting, history and focus; commands call the CRM's
// existing save functions, so the server stays authoritative for validation.
//
// Bundled by tools/build-backend-client.mjs into crm_backend/client/.

import { Badge, Button, DataTable, Inline, Notice, Stack } from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type {
  RecordModalCommand,
  RecordModalContext,
  RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordDialogTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { CRM_RECORD_MODAL_LABELS } from '../../crm/record-modal-labels.ts'

// biome-ignore lint/suspicious/noExplicitAny: rows are JSON shaped by the crm modal contexts
type AnyRow = Record<string, any>
type Base = { record: AnyRow; permissions: Record<string, boolean>; lang: string }
export type TeamData = Base & { members: AnyRow[]; people: AnyRow[]; assignmentModes: string[] }
export type StageData = Base & { teams: AnyRow[]; kinds: string[]; terminalStates: string[] }
export type TagData = Base
export type AssignmentRuleData = Base & {
  teams: AnyRow[]
  assignees: Record<string, AnyRow[]>
  kinds: string[]
}
export type ScoreRuleData = Base & { operators: Record<string, string[]> }

type Context<Data> = RecordModalContext<Data>

// ── Helpers ─────────────────────────────────────────────────────────────────

const COMMAND_FIELD = '__command'

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'

const contextOf = (fn: string) => ({
  fn,
  input: (id: string, creating: boolean) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
})

const labels = () => CRM_RECORD_MODAL_LABELS[pageLang()]

const t = <Data,>(c: Context<Data>, key: string, params?: Record<string, unknown>): string =>
  c.t(`crm_backend.${key}`, params)

const canSave = (c: Context<Base>): boolean => c.data.permissions.save === true
const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim()
const checked = (form: FormData, name: string): boolean =>
  ['1', 'on', 'true'].includes(String(form.get(name) ?? ''))
const number = (form: FormData, name: string, fallback: number): number => {
  const raw = text(form, name)
  const value = Number(raw)
  return raw === '' || Number.isNaN(value) ? fallback : value
}

const fieldId = (c: Context<Base>, name: string): string => `crm-${c.kind.replace('.', '-')}-${name}`

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context<Base>, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: fieldId(c, props.name),
  value:
    props.type === 'checkbox'
      ? c.draftChecked(props.name, '1', props.value === true || props.value === '1')
      : props.type === 'checkbox-group'
        ? props.value
        : c.draft(props.name, String(props.value ?? '')),
  options:
    props.type === 'checkbox-group'
      ? props.options?.map((option) => ({
          ...option,
          checked: c.draftChecked(option.name ?? `${props.name}[]`, option.value, option.checked === true),
        }))
      : props.options,
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !canSave(c),
})

/**
 * A select whose choice changes what the rest of the form offers. The design
 * system's field frame with a control carrying `data-record-state`, so the
 * runtime re-renders the view with the new choice before anything is submitted.
 */
const stateSelect = (
  c: Context<Base>,
  props: {
    name: string
    label: string
    state: string
    value: string
    options: FieldOption[]
    required?: boolean
  },
): FieldProps => {
  const base = field(c, { name: props.name, label: props.label, type: 'select', required: props.required })
  return {
    ...base,
    options: props.options,
    control: recordStateSelectControl({
      id: base.id,
      name: props.name,
      state: props.state,
      value: props.value,
      options: props.options,
      required: props.required,
      disabled: base.disabled === true,
      invalid: !!base.error,
    }),
  }
}

const kindsField = (c: Context<Base & { kinds: string[] }>): FieldProps => {
  const allowed: unknown[] = Array.isArray(c.data.record.allowedKinds) ? c.data.record.allowedKinds : []
  return field(c, {
    name: 'allowedKinds',
    label: t(c, 'field.allowedKinds'),
    type: 'checkbox-group',
    required: true,
    span: 'full',
    options: c.data.kinds.map((kind) => ({
      name: `kind_${kind}`,
      value: '1',
      label: c.t(`crm.kind.${kind}`),
      checked: allowed.includes(kind),
    })),
  })
}

const kindsOf = (form: FormData, kinds: readonly string[]): string[] =>
  kinds.filter((kind) => checked(form, `kind_${kind}`))

const teamOptions = (c: Context<Base & { teams: AnyRow[] }>): FieldOption[] =>
  c.data.teams.map((team) => ({
    value: String(team.id),
    label:
      team.active === false ? t(c, 'value.archivedTeam', { name: String(team.name) }) : String(team.name),
  }))

const isActive = (c: Context<Base>): boolean => c.data.record.active !== false

/** The status of an existing record, next to its title. */
const statusHeader = (c: Context<Base>): JSXChild =>
  c.creating
    ? ''
    : Inline({
        items: [
          Badge({
            label: isActive(c) ? t(c, 'state.active') : t(c, 'state.archived'),
            tone: isActive(c) ? 'positive' : 'neutral',
            value: isActive(c) ? 'active' : 'archived',
          }),
        ],
      })

/**
 * The record form. A viewer who may not save sees the same fields disabled and
 * no actions. Archive and restore are explicit actions, not a checkbox.
 */
const configurationForm = (
  c: Context<Base>,
  fields: readonly FieldProps[],
  archivable = true,
): TemplateResult => {
  const editable = canSave(c)
  const actions: JSXChild[] = []
  if (editable) {
    actions.push(
      Button({
        type: 'submit',
        name: COMMAND_FIELD,
        value: c.creating ? 'create' : 'save',
        label: c.creating ? t(c, 'configuration.create') : t(c, 'action.save'),
        variant: 'primary',
        loading: c.busy,
      }),
    )
    if (!c.creating && archivable && (c.data.permissions.archive ?? true))
      actions.push(
        Button({
          type: 'submit',
          name: COMMAND_FIELD,
          value: isActive(c) ? 'archive' : 'restore',
          label: isActive(c) ? t(c, 'action.archive') : t(c, 'action.restore'),
          variant: 'secondary',
          disabled: c.busy,
        }),
      )
  }
  return Stack({
    gap: 'compact',
    items: [
      editable
        ? ''
        : Notice({ title: t(c, 'configuration.readOnlyTitle'), message: t(c, 'configuration.readOnly') }),
      RecordModalForm({ kind: c.kind, fields, actions }),
    ],
  })
}

/** Create, save, archive and restore through one versioned save function. */
const versionedCommands = <Data extends Base>(
  fn: string,
  values: (form: FormData, c: Context<Data>) => AnyRow,
): Record<string, RecordModalCommand<Data>> => {
  const keyed = (rowValues: AnyRow) => ({ values: rowValues, idempotencyKey: uuid() })
  const stored = (c: Context<Data>) => ({
    ...c.data.record,
    id: c.id,
    expectedVersion: c.data.record.version ?? null,
  })
  return {
    create: {
      fn,
      input: (form, c) => keyed({ ...values(form, c), id: uuid() }),
      after: 'open',
      created: (value) => ((value as AnyRow | null)?.id ? String((value as AnyRow).id) : null),
    },
    save: {
      fn,
      input: (form, c) =>
        keyed({ ...values(form, c), id: c.id, expectedVersion: c.data.record.version ?? null }),
      after: 'refresh',
    },
    archive: { fn, input: (_form, c) => keyed({ ...stored(c), active: false }), after: 'refresh' },
    restore: { fn, input: (_form, c) => keyed({ ...stored(c), active: true }), after: 'refresh' },
  }
}

const createTitle = (c: Context<Base>, key: string): string =>
  c.creating ? t(c, key) : String(c.data.record.name ?? c.id)

// ── Team ────────────────────────────────────────────────────────────────────

export const teamInfoView = (c: Context<TeamData>): TemplateResult =>
  configurationForm(c, [
    field(c, { name: 'name', label: t(c, 'field.configName'), value: c.data.record.name, required: true }),
    field(c, { name: 'code', label: t(c, 'field.code'), value: c.data.record.code, required: true }),
    field(c, {
      name: 'leaderUserId',
      label: t(c, 'field.teamLeader'),
      type: 'select',
      value: c.data.record.leaderUserId ?? '',
      options: [
        { value: '', label: t(c, 'value.unset') },
        ...c.data.people.map((person) => ({ value: String(person.id), label: String(person.name) })),
      ],
    }),
    field(c, {
      name: 'assignmentMode',
      label: t(c, 'field.assignmentMode'),
      type: 'select',
      value: c.data.record.assignmentMode ?? 'manual',
      options: c.data.assignmentModes.map((mode) => ({ value: mode, label: t(c, `assignmentMode.${mode}`) })),
    }),
  ])

/** A button that opens the member dialog of this team, for one member or a new one. */
const memberOpener = (label: string, memberId: string | null, variant: 'secondary' | 'tertiary'): JSXChild =>
  RecordDialogTrigger({
    dialog: 'member',
    id: memberId,
    children: Button({ label, variant, size: variant === 'tertiary' ? 'compact' : 'default' }),
  })

export const teamMembersView = (c: Context<TeamData>): TemplateResult => {
  const manage = c.data.permissions.members === true
  const members = c.data.members
  const activeBadge = (row: AnyRow) =>
    Badge({
      label: row.active === false ? t(c, 'state.archived') : t(c, 'state.active'),
      tone: row.active === false ? 'neutral' : 'positive',
    })
  return Stack({
    gap: 'compact',
    items: [
      Inline({
        items: [
          t(c, 'configuration.team.membersHint'),
          manage ? memberOpener(t(c, 'configuration.team.addMember'), null, 'secondary') : '',
        ],
      }),
      members.length
        ? DataTable<AnyRow>({
            rows: members,
            id: (row) => String(row.id),
            responsive: 'stack',
            columns: [
              {
                key: 'name',
                label: t(c, 'configuration.team.member'),
                priority: 'primary',
                cell: (row) =>
                  manage
                    ? memberOpener(String(row.userName ?? row.userId), String(row.id), 'tertiary')
                    : String(row.userName ?? row.userId),
              },
              {
                key: 'capacity',
                label: t(c, 'field.capacity'),
                kind: 'number',
                cell: (row) => String(row.capacity ?? 1),
              },
              {
                key: 'sequence',
                label: t(c, 'field.sequence'),
                kind: 'number',
                cell: (row) => String(row.sequence ?? 10),
              },
              {
                key: 'assigned',
                label: t(c, 'configuration.team.assigned'),
                kind: 'number',
                cell: (row) => String(row.assignedCount ?? 0),
              },
              { key: 'active', label: t(c, 'field.active'), kind: 'status', cell: activeBadge },
            ],
          })
        : Notice({
            title: t(c, 'configuration.team.membersEmpty'),
            message: t(c, 'configuration.team.membersEmptyHint'),
          }),
    ],
  })
}

const editedMember = (c: Context<TeamData>): AnyRow | null => {
  const id = c.dialog?.params.id
  return id ? (c.data.members.find((row) => String(row.id) === id) ?? null) : null
}

export const memberDialogView = (c: Context<TeamData>): TemplateResult => {
  const member = editedMember(c)
  // A person is a member of a team once: the picker leaves out everyone already in it.
  const taken = new Set(
    c.data.members.filter((row) => row.id !== member?.id).map((row) => String(row.userId)),
  )
  const editable = c.data.permissions.members === true
  const people = c.data.people.filter((person) => !taken.has(String(person.id)))
  const memberField = (props: Omit<FieldProps, 'id'>): FieldProps => ({
    ...field(c, props),
    id: `crm-team-member-${props.name}`,
    disabled: !editable,
  })
  return RecordModalForm({
    kind: c.kind,
    command: 'memberSave',
    fields: [
      memberField({
        name: 'userId',
        label: t(c, 'configuration.team.member'),
        type: 'select',
        required: true,
        value: member?.userId ?? '',
        options: [
          { value: '', label: t(c, 'value.unset') },
          ...people.map((person) => ({ value: String(person.id), label: String(person.name) })),
        ],
      }),
      memberField({
        name: 'capacity',
        label: t(c, 'field.capacity'),
        type: 'number',
        min: 1,
        value: String(member?.capacity ?? 1),
        help: t(c, 'field.capacityHint'),
      }),
      memberField({
        name: 'sequence',
        label: t(c, 'field.sequence'),
        type: 'number',
        value: String(member?.sequence ?? 10),
      }),
      memberField({
        name: 'active',
        label: t(c, 'field.active'),
        type: 'checkbox',
        value: member ? member.active !== false : true,
      }),
    ],
    actions: editable
      ? [
          Button({
            type: 'submit',
            label: member ? t(c, 'action.save') : t(c, 'configuration.team.addMember'),
            variant: 'primary',
            loading: c.busy,
          }),
        ]
      : [],
  })
}

export const teamDefinition: RecordModalDefinition<TeamData> = {
  kind: 'crm.team',
  size: 'large',
  context: contextOf('crm.team.modalContext'),
  labels,
  title: (c) => createTitle(c, 'configuration.team.create'),
  description: (c) => t(c, 'configuration.team.subtitle'),
  header: statusHeader,
  tabs: [
    { id: 'info', label: (c) => t(c, 'configuration.team.identity'), view: teamInfoView },
    {
      id: 'members',
      label: (c) => t(c, 'configuration.membersInTeam'),
      visible: (c) => !c.creating,
      view: teamMembersView,
    },
  ],
  dialogs: {
    member: {
      title: (c) =>
        editedMember(c) ? t(c, 'configuration.team.editMember') : t(c, 'configuration.team.addMember'),
      view: memberDialogView,
    },
  },
  commands: {
    ...versionedCommands<TeamData>('crm.team.save', (form) => ({
      name: text(form, 'name'),
      code: text(form, 'code'),
      leaderUserId: text(form, 'leaderUserId') || null,
      assignmentMode: text(form, 'assignmentMode') || 'manual',
    })),
    memberSave: {
      fn: 'crm.team.member.save',
      input: (form, c) => ({
        id: c.dialog?.params.id || uuid(),
        teamId: c.id,
        userId: text(form, 'userId'),
        capacity: number(form, 'capacity', 1),
        sequence: number(form, 'sequence', 10),
        active: checked(form, 'active'),
        idempotencyKey: uuid(),
      }),
      // Read the team again so the member list shows the change; closes the dialog.
      after: 'reload',
    },
  },
}

// ── Stage ───────────────────────────────────────────────────────────────────

export const stageView = (c: Context<StageData>): TemplateResult =>
  configurationForm(c, [
    field(c, { name: 'name', label: t(c, 'field.configName'), value: c.data.record.name, required: true }),
    field(c, { name: 'code', label: t(c, 'field.code'), value: c.data.record.code, required: true }),
    field(c, {
      name: 'sequence',
      label: t(c, 'field.sequence'),
      type: 'number',
      value: c.data.record.sequence ?? 10,
    }),
    kindsField(c),
    field(c, {
      name: 'teamId',
      label: t(c, 'field.team'),
      type: 'select',
      value: c.data.record.teamId ?? '',
      options: [{ value: '', label: t(c, 'value.allTeams') }, ...teamOptions(c)],
    }),
    field(c, {
      name: 'terminalState',
      label: t(c, 'field.terminalState'),
      type: 'select',
      value: c.data.record.terminalState ?? 'open',
      options: c.data.terminalStates.map((state) => ({ value: state, label: c.t(`crm.terminal.${state}`) })),
    }),
    field(c, {
      name: 'fold',
      label: t(c, 'field.fold'),
      type: 'checkbox',
      value: c.data.record.fold === true,
    }),
  ])

export const stageDefinition: RecordModalDefinition<StageData> = {
  kind: 'crm.stage',
  size: 'large',
  context: contextOf('crm.stage.modalContext'),
  labels,
  title: (c) => createTitle(c, 'configuration.stage.create'),
  header: statusHeader,
  body: stageView,
  commands: versionedCommands<StageData>('crm.stage.save', (form, c) => ({
    name: text(form, 'name'),
    code: text(form, 'code'),
    sequence: number(form, 'sequence', 10),
    allowedKinds: kindsOf(form, c.data.kinds),
    teamId: text(form, 'teamId') || null,
    terminalState: text(form, 'terminalState') || 'open',
    fold: checked(form, 'fold'),
  })),
}

// ── Tag ─────────────────────────────────────────────────────────────────────

export const tagView = (c: Context<TagData>): TemplateResult =>
  configurationForm(c, [
    field(c, { name: 'name', label: t(c, 'field.configName'), value: c.data.record.name, required: true }),
    field(c, {
      name: 'color',
      label: t(c, 'field.color'),
      type: 'color',
      value: c.data.record.color || '#64748b',
    }),
  ])

export const tagDefinition: RecordModalDefinition<TagData> = {
  kind: 'crm.tag',
  context: contextOf('crm.tag.modalContext'),
  labels,
  title: (c) => createTitle(c, 'configuration.tag.create'),
  header: statusHeader,
  body: tagView,
  commands: {
    create: {
      fn: 'crm.tag.save',
      input: (form) => ({ id: uuid(), name: text(form, 'name'), color: text(form, 'color') || null }),
      after: 'open',
      created: (value) => ((value as AnyRow | null)?.id ? String((value as AnyRow).id) : null),
    },
    save: {
      fn: 'crm.tag.save',
      input: (form, c) => ({ id: c.id, name: text(form, 'name'), color: text(form, 'color') || null }),
      after: 'refresh',
    },
    // Archiving a tag also takes it off the cases that carry it.
    archive: { fn: 'crm.tag.archive', input: (_form, c) => ({ id: c.id }), after: 'refresh' },
    restore: {
      fn: 'crm.tag.save',
      input: (_form, c) => ({ id: c.id, name: String(c.data.record.name ?? ''), active: true }),
      after: 'refresh',
    },
  },
}

// ── Assignment rule ─────────────────────────────────────────────────────────

/** The team the form currently names: the reader's choice, what they typed before a refusal, or the stored one. */
export const chosenTeam = (c: Context<AssignmentRuleData>): string =>
  c.state('team', c.draft('teamId', String(c.data.record.teamId ?? '')))

export const assignmentRuleView = (c: Context<AssignmentRuleData>): TemplateResult => {
  const team = chosenTeam(c)
  const assignees = c.data.assignees[team] ?? []
  return configurationForm(c, [
    field(c, { name: 'name', label: t(c, 'field.configName'), value: c.data.record.name, required: true }),
    field(c, {
      name: 'priority',
      label: t(c, 'field.priority'),
      type: 'number',
      value: c.data.record.priority ?? 10,
      help: t(c, 'field.priorityHint'),
    }),
    kindsField(c),
    stateSelect(c, {
      name: 'teamId',
      label: t(c, 'field.team'),
      state: 'team',
      required: true,
      value: team,
      options: [{ value: '', label: t(c, 'value.unset') }, ...teamOptions(c)],
    }),
    field(c, {
      name: 'assigneeUserId',
      label: t(c, 'field.assignee'),
      type: 'select',
      value: assignees.some((person) => String(person.id) === String(c.data.record.assigneeUserId))
        ? String(c.data.record.assigneeUserId)
        : '',
      options: [
        { value: '', label: t(c, 'value.teamMode') },
        ...assignees.map((person) => ({ value: String(person.id), label: String(person.name) })),
      ],
    }),
    field(c, { name: 'utmSource', label: t(c, 'field.utmSource'), value: c.data.record.utmSource ?? '' }),
    field(c, {
      name: 'minimumScore',
      label: t(c, 'field.minimumScore'),
      type: 'number',
      value: c.data.record.minimumScore ?? '',
    }),
  ])
}

export const assignmentRuleDefinition: RecordModalDefinition<AssignmentRuleData> = {
  kind: 'crm.assignmentRule',
  size: 'large',
  context: contextOf('crm.assignmentRule.modalContext'),
  labels,
  title: (c) => createTitle(c, 'configuration.assignmentRule.create'),
  header: statusHeader,
  body: assignmentRuleView,
  commands: versionedCommands<AssignmentRuleData>('crm.assignmentRule.save', (form, c) => ({
    name: text(form, 'name'),
    priority: number(form, 'priority', 10),
    allowedKinds: kindsOf(form, c.data.kinds),
    teamId: text(form, 'teamId') || null,
    assigneeUserId: text(form, 'assigneeUserId') || null,
    utmSource: text(form, 'utmSource') || null,
    minimumScore: text(form, 'minimumScore') === '' ? null : text(form, 'minimumScore'),
  })),
}

// ── Score rule ──────────────────────────────────────────────────────────────

/** The field and operator the form currently names; an operator the field does not accept falls back to its first. */
export const scoreRuleChoice = (
  c: Context<ScoreRuleData>,
): { field: string; operator: string; operators: string[] } => {
  const fields = Object.keys(c.data.operators)
  const asked = c.state('field', c.draft('field', String(c.data.record.field ?? fields[0] ?? '')))
  const chosenField = fields.includes(asked) ? asked : (fields[0] ?? '')
  const operators = c.data.operators[chosenField] ?? []
  const wanted = c.state('operator', c.draft('operator', String(c.data.record.operator ?? '')))
  return {
    field: chosenField,
    operators,
    operator: operators.includes(wanted) ? wanted : (operators[0] ?? ''),
  }
}

export const scoreRuleView = (c: Context<ScoreRuleData>): TemplateResult => {
  const choice = scoreRuleChoice(c)
  return configurationForm(c, [
    field(c, { name: 'name', label: t(c, 'field.configName'), value: c.data.record.name, required: true }),
    stateSelect(c, {
      name: 'field',
      label: t(c, 'field.ruleField'),
      state: 'field',
      required: true,
      value: choice.field,
      options: Object.keys(c.data.operators).map((name) => ({
        value: name,
        label: t(c, `scoreField.${name}`),
      })),
    }),
    stateSelect(c, {
      name: 'operator',
      label: t(c, 'field.operator'),
      state: 'operator',
      required: true,
      value: choice.operator,
      options: choice.operators.map((operator) => ({ value: operator, label: t(c, `operator.${operator}`) })),
    }),
    // "Is set" compares nothing, so there is no value to type.
    ...(choice.operator === 'present'
      ? []
      : [
          field(c, {
            name: 'value',
            label: t(c, 'field.ruleValue'),
            type: choice.field === 'expectedRevenue' ? 'number' : 'text',
            value: c.data.record.value ?? '',
            required: true,
          }),
        ]),
    field(c, {
      name: 'points',
      label: t(c, 'field.points'),
      type: 'number',
      value: c.data.record.points ?? 0,
    }),
    field(c, {
      name: 'sequence',
      label: t(c, 'field.sequence'),
      type: 'number',
      value: c.data.record.sequence ?? 10,
    }),
  ])
}

export const scoreRuleDefinition: RecordModalDefinition<ScoreRuleData> = {
  kind: 'crm.scoreRule',
  size: 'large',
  context: contextOf('crm.scoreRule.modalContext'),
  labels,
  title: (c) => createTitle(c, 'configuration.scoreRule.create'),
  header: statusHeader,
  body: scoreRuleView,
  commands: versionedCommands<ScoreRuleData>('crm.scoreRule.save', (form) => {
    const operator = text(form, 'operator')
    return {
      name: text(form, 'name'),
      field: text(form, 'field'),
      operator,
      value: operator === 'present' ? '' : text(form, 'value'),
      points: text(form, 'points') || '0',
      sequence: number(form, 'sequence', 10),
    }
  }),
}

// ── Islands ─────────────────────────────────────────────────────────────────

export const crmTeamModal = createRecordModal(teamDefinition)
export const crmStageModal = createRecordModal(stageDefinition)
export const crmTagModal = createRecordModal(tagDefinition)
export const crmAssignmentRuleModal = createRecordModal(assignmentRuleDefinition)
export const crmScoreRuleModal = createRecordModal(scoreRuleDefinition)
