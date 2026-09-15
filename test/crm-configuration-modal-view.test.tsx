import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { RECORD_MODAL_LABELS } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  assignmentRuleDefinition,
  assignmentRuleView,
  memberDialogView,
  scoreRuleChoice,
  scoreRuleDefinition,
  scoreRuleView,
  stageView,
  tagDefinition,
  teamDefinition,
  teamInfoView,
} from '../packages/ketsuite/src/modules/crm_backend/modal/configuration-modal-view.tsx'
import type {
  AssignmentRuleData,
  ScoreRuleData,
  StageData,
  TeamData,
} from '../packages/ketsuite/src/modules/crm_backend/modal/configuration-modal-view.tsx'
import { CRM_RECORD_MODAL_LABELS } from '../packages/ketsuite/src/modules/crm/record-modal-labels.ts'

type Options = {
  creating?: boolean
  state?: Record<string, string>
  drafts?: Record<string, string>
  dialog?: { name: string; params: Record<string, string> } | null
}

const contextOf = <Data,>(kind: string, data: Data, options: Options = {}): RecordModalContext<Data> => ({
  kind,
  id: options.creating ? 'new' : 'record-1',
  creating: options.creating === true,
  tab: '',
  data,
  t: (key, params) => (key === 'crm_backend.value.archivedTeam' ? `${String(params?.name)} (archived)` : key),
  fieldError: () => null,
  draft: (name, fallback = '') => options.drafts?.[name] ?? fallback,
  busy: false,
  dialog: options.dialog ?? null,
  href: () => '',
  state: (key, fallback = '') => options.state?.[key] ?? fallback,
})

const OPERATORS = {
  email: ['eq', 'contains', 'present'],
  utmSource: ['eq', 'contains', 'present'],
  expectedRevenue: ['gte', 'eq'],
}
const scoreData = (record: Record<string, unknown>): ScoreRuleData => ({
  record,
  operators: OPERATORS,
  permissions: { save: true },
  lang: 'vi',
})
const optionsOf = (html: string, name: string): string[] => {
  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html)
  assert.ok(select, `a ${name} select`)
  return [...select[1]!.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]!)
}

test('crm configuration modal: a score rule offers only the operators its field accepts', () => {
  const revenue = renderToString(
    scoreRuleView(
      contextOf('crm.scoreRule', scoreData({ name: 'Doanh thu', field: 'expectedRevenue', operator: 'gte' })),
    ),
  )
  assert.deepEqual(optionsOf(revenue, 'operator'), ['gte', 'eq'])
  // Both choices drive the view through the runtime's view state.
  assert.match(revenue, /<select[^>]*data-record-state="field"[^>]*name="field"/)
  assert.match(revenue, /<select[^>]*data-record-state="operator"[^>]*name="operator"/)
  assert.match(revenue, /name="value"/)

  // Choosing a text field re-renders the operators; a stale choice falls back to the field's first.
  const switched = contextOf('crm.scoreRule', scoreData({ field: 'expectedRevenue', operator: 'gte' }), {
    state: { field: 'email' },
  })
  assert.deepEqual(scoreRuleChoice(switched), { field: 'email', operator: 'eq', operators: OPERATORS.email })
  assert.deepEqual(optionsOf(renderToString(scoreRuleView(switched)), 'operator'), [
    'eq',
    'contains',
    'present',
  ])
})

test('crm configuration modal: "is set" has no value to type', () => {
  const present = renderToString(
    scoreRuleView(
      contextOf('crm.scoreRule', scoreData({ field: 'email', operator: 'eq', value: 'x' }), {
        state: { operator: 'present' },
      }),
    ),
  )
  assert.doesNotMatch(present, /name="value"/)
  const form = new FormData()
  for (const [name, value] of Object.entries({
    name: 'Có email',
    field: 'email',
    operator: 'present',
    value: 'left over',
  }))
    form.set(name, value)
  const command = scoreRuleDefinition.commands!.create!.input(
    form,
    contextOf('crm.scoreRule', scoreData({}), { creating: true }),
    {},
  ) as { values: Record<string, unknown> }
  assert.equal(command.values.value, '', 'a present rule saves no value')
})

test('crm configuration modal: an assignment rule offers the chosen team’s members and leader only', () => {
  const data: AssignmentRuleData = {
    record: { name: 'Lead nóng', teamId: 'north', assigneeUserId: 'an', allowedKinds: ['lead'] },
    teams: [
      { id: 'north', name: 'Miền Bắc', active: true },
      { id: 'south', name: 'Miền Nam', active: false },
    ],
    assignees: { north: [{ id: 'an', name: 'An' }], south: [{ id: 'binh', name: 'Bình' }] },
    kinds: ['lead', 'opportunity'],
    permissions: { save: true },
    lang: 'vi',
  }
  const north = renderToString(assignmentRuleView(contextOf('crm.assignmentRule', data)))
  assert.deepEqual(optionsOf(north, 'assigneeUserId'), ['', 'an'])
  assert.match(north, /<select[^>]*data-record-state="team"[^>]*name="teamId"/)
  assert.match(north, /Miền Nam \(archived\)/, 'an archived team the rule still names is marked')

  const south = renderToString(
    assignmentRuleView(contextOf('crm.assignmentRule', data, { state: { team: 'south' } })),
  )
  assert.deepEqual(optionsOf(south, 'assigneeUserId'), ['', 'binh'])
  assert.equal(assignmentRuleDefinition.kind, 'crm.assignmentRule')
})

const team = (overrides: Partial<TeamData> = {}): TeamData => ({
  record: { name: 'Miền Bắc', code: 'north', assignmentMode: 'manual', active: true, version: 4 },
  members: [{ id: 'm-1', userId: 'an', userName: 'An', capacity: 2, sequence: 10, active: true }],
  people: [
    { id: 'an', name: 'An' },
    { id: 'binh', name: 'Bình' },
  ],
  assignmentModes: ['manual', 'round_robin', 'capacity'],
  permissions: { save: true, members: true },
  lang: 'vi',
  ...overrides,
})

test('crm configuration modal: archive and restore are explicit actions, and a reader sees a read-only form', () => {
  const active = renderToString(teamInfoView(contextOf('crm.team', team())))
  assert.match(active, /name="__command" value="save"/)
  assert.match(active, /name="__command" value="archive"/)
  assert.doesNotMatch(active, /name="active"/, 'no "active" checkbox stands in for archiving')
  assert.match(active, /crm_backend\.field\.configName/)

  const archived = renderToString(
    teamInfoView(contextOf('crm.team', team({ record: { name: 'Cũ', code: 'old', active: false } }))),
  )
  assert.match(archived, /name="__command" value="restore"/)

  const creating = renderToString(
    teamInfoView(contextOf('crm.team', team({ record: { name: '' } }), { creating: true })),
  )
  assert.match(creating, /name="__command" value="create"/)
  assert.doesNotMatch(creating, /value="archive"|value="restore"/)

  const reader = renderToString(
    teamInfoView(contextOf('crm.team', team({ permissions: { save: false, members: false } }))),
  )
  assert.doesNotMatch(reader, /type="submit"/)
  assert.match(reader, /crm_backend\.configuration\.readOnly/)
  assert.match(reader, /<input[^>]*name="name"[^>]*disabled/)

  const stage = renderToString(
    stageView(
      contextOf<StageData>('crm.stage', {
        record: { name: 'Mới', code: 'new', terminalState: 'open', allowedKinds: ['lead'] },
        teams: [],
        kinds: ['lead', 'opportunity'],
        terminalStates: ['open', 'won', 'lost'],
        permissions: { save: true },
        lang: 'vi',
      }),
    ),
  )
  assert.match(
    stage,
    /crm_backend\.field\.terminalState/,
    'the stage form names the terminal state as its column does',
  )
  assert.doesNotMatch(stage, /crm_backend\.field\.state"/)
})

test('crm configuration modal: the team shows members only once it exists, and adds them in a dialog', () => {
  const members = teamDefinition.tabs!.find((tab) => tab.id === 'members')!
  assert.equal(members.visible!(contextOf('crm.team', team(), { creating: true })), false)
  assert.equal(members.visible!(contextOf('crm.team', team())), true)

  const adding = renderToString(
    memberDialogView(contextOf('crm.team', team(), { dialog: { name: 'member', params: {} } })),
  )
  assert.deepEqual(
    optionsOf(adding, 'userId'),
    ['', 'binh'],
    'a person already in the team is not offered again',
  )
  assert.match(adding, /name="__command" value="memberSave"/)

  const editing = contextOf('crm.team', team(), { dialog: { name: 'member', params: { id: 'm-1' } } })
  assert.deepEqual(optionsOf(renderToString(memberDialogView(editing)), 'userId'), ['', 'an', 'binh'])
  const form = new FormData()
  form.set('userId', 'an')
  form.set('capacity', '3')
  form.set('active', '1')
  const input = teamDefinition.commands!.memberSave!.input(form, editing, {})
  assert.equal(input.id, 'm-1')
  assert.equal(input.teamId, 'record-1')
  assert.equal(input.capacity, 3)
  assert.equal(input.active, true)
  assert.equal(teamDefinition.commands!.memberSave!.after, 'reload')
})

test('crm configuration modal: create opens the new record; save refreshes; archive keeps the version', () => {
  const commands = teamDefinition.commands!
  assert.equal(commands.create!.after, 'open')
  assert.equal(commands.create!.created!({ ok: true, id: 'team-9' }), 'team-9')
  const form = new FormData()
  form.set('name', 'Miền Trung')
  form.set('code', 'central')
  const created = commands.create!.input(form, contextOf('crm.team', team(), { creating: true }), {}) as {
    values: Record<string, unknown>
    idempotencyKey: string
  }
  assert.notEqual(created.values.id, 'new', 'a create mints the record id')
  assert.equal(created.values.name, 'Miền Trung')
  assert.ok(created.idempotencyKey)
  assert.equal(commands.save!.after, 'refresh')
  const archived = commands.archive!.input(new FormData(), contextOf('crm.team', team()), {}) as {
    values: Record<string, unknown>
  }
  assert.equal(archived.values.active, false)
  assert.equal(archived.values.expectedVersion, 4)
  assert.equal(archived.values.code, 'north')

  const tags = tagDefinition.commands!
  assert.equal(tags.archive!.fn, 'crm.tag.archive', 'archiving a tag also takes it off its cases')
  const colored = new FormData()
  colored.set('name', 'VIP')
  colored.set('color', '#ff0000')
  assert.equal(
    (tags.create!.input(colored, contextOf('crm.tag', team(), { creating: true }), {}) as { color: string })
      .color,
    '#ff0000',
  )
})

test('crm configuration modal: runtime labels exist in both languages', () => {
  for (const lang of ['vi', 'en'] as const)
    for (const key of Object.keys(RECORD_MODAL_LABELS))
      assert.ok(CRM_RECORD_MODAL_LABELS[lang][key], `${lang} ${key}`)
  assert.equal(teamDefinition.labels !== undefined, true)
})
