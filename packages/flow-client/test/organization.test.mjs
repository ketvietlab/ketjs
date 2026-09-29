import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
const read = (s, args = {}) => s.call('flow.workspace.bootstrap', { companyId: 'demo', ...args }).value
const command = (s, action, args = {}) =>
  s.call('flow.organization.command', {
    companyId: 'demo',
    action,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: crypto.randomUUID(),
    ...args,
  }).value
test('Company datasets and direct links stay isolated; Workspace is inside Company', () => {
  const s = createOrganizationSession(),
    a = read(s),
    b = read(s, { companyId: 'north' })
  assert.equal(a.company.id, 'demo')
  assert.equal(b.company.id, 'north')
  assert.ok(b.projects.every((p) => p.companyId === 'north' && p.workspaceId.startsWith('north-')))
  assert.ok(b.tasks.every((t) => t.id.startsWith('north-')))
  assert.equal(read(s, { companyId: 'north', projectId: 'core' }).errors[0].code, 'forbidden')
  const link = read(s, { recordId: 'KV-129', route: 'issue', workspaceId: 'product' })
  assert.equal(link.context.projectId, 'ops')
  assert.equal(link.context.workspaceId, 'operations')
})
test('guest sees only its explicitly granted project; member cannot read private or unrelated projects', () => {
  const guest = createOrganizationSession('guest'),
    g = read(guest)
  assert.deepEqual(
    g.projects.map((p) => p.id),
    ['docs'],
  )
  assert.ok(g.tasks.every((t) => t.projectId === 'docs'))
  assert.ok(g.pages.every((p) => p.projectId === 'docs'))
  assert.equal(g.capabilities.write, false)
  assert.equal(g.sprints.length, 0)
  assert.equal(g.epics.length, 0)
  assert.equal(g.goals, undefined)
  assert.equal(g.github, undefined)
  assert.equal(read(guest, { recordId: 'KV-142' }).errors[0].code, 'forbidden')
  assert.equal(read(guest, { companyId: 'north' }).errors[0].code, 'forbidden')
  const member = read(createOrganizationSession('member'))
  assert.deepEqual(
    member.projects.map((p) => p.id),
    ['core'],
  )
  assert.equal(read(createOrganizationSession('revoked')).errors[0].code, 'revoked')
})
test('project move previews lost and gained inherited rights, rejects stale and cross-company targets, supports retaining access', () => {
  const s = createOrganizationSession(),
    args = { companyId: 'demo', projectId: 'core', targetWorkspaceId: 'operations' }
  const preview = s.call('flow.project.move.preview', args).value
  assert.equal(preview.people.find((x) => x.id === 'bao').change, 'loss')
  assert.equal(preview.people.find((x) => x.id === 'ha').change, 'gain')
  assert.equal(
    s.call('flow.project.move.preview', { ...args, targetWorkspaceId: 'north-operations' }).value.errors[0]
      .code,
    'validation',
  )
  command(s, 'team.save', { title: 'QA' })
  assert.equal(
    command(s, 'project.move', { ...args, id: 'core', expectedRevision: preview.revision }).errors[0].code,
    'conflict',
  )
  assert.notEqual(command(s, 'project.move', { ...args, id: 'core', preserve: true }).ok, false)
  const d = read(s)
  assert.equal(d.projects.find((p) => p.id === 'core').workspaceId, 'operations')
  assert.ok(d.grants.some((g) => g.targetId === 'core' && g.subjectId === 'bao' && g.subjectType === 'user'))
  assert.equal(d.tasks.find((t) => t.id === 'KV-142').projectId, 'core')
})
test('short creation forms, invitations, revocation and archive enforce prototype boundaries', () => {
  const s = createOrganizationSession()
  const ws = command(s, 'workspace.save', { title: 'Nội dung', access: 'private' })
  assert.ok(ws.id)
  const created = s.call('flow.entity.save', {
    companyId: 'demo',
    workspaceId: ws.id,
    collection: 'projects',
    title: 'Tạp chí',
    code: 'MAG',
    idempotencyKey: 'create-mag',
  }).value
  assert.equal(read(s).projects.find((p) => p.id === created.id).workspaceId, ws.id)
  assert.equal(command(s, 'workspace.archive', { id: ws.id }).errors[0].code, 'activeProjects')
  assert.equal(
    command(s, 'member.invite', { email: 'a@example.test', role: 'guest' }).errors[0].code,
    'validation',
  )
  command(s, 'member.invite', { email: 'a@example.test', role: 'guest', projectId: 'docs' })
  assert.equal(read(s).invitations.at(-1).status, 'pending')
  const guest = createOrganizationSession('guest')
  assert.equal(command(guest, 'workspace.save', { title: 'No' }).errors[0].code, 'forbidden')
  const viewer = createOrganizationSession('readonly')
  assert.equal(command(viewer, 'workspace.save', { title: 'No' }).errors[0].code, 'forbidden')
})
test('removing one grant retains other sources; guest grants cannot target Workspace', () => {
  const s = createOrganizationSession()
  command(s, 'access.grant', {
    scope: 'project',
    targetId: 'core',
    subjectType: 'user',
    subjectId: 'bao',
    role: 'viewer',
  })
  command(s, 'access.revoke', { id: 'g1' })
  const preview = s.call('flow.project.move.preview', {
    companyId: 'demo',
    projectId: 'core',
    targetWorkspaceId: 'operations',
  }).value
  assert.equal(preview.people.find((x) => x.id === 'bao').before.role, 'viewer')
  assert.equal(
    command(s, 'access.grant', {
      scope: 'workspace',
      targetId: 'product',
      subjectType: 'user',
      subjectId: 'guest',
      role: 'viewer',
    }).errors[0].code,
    'validation',
  )
})

test('revoked membership overrides every source and archived Workspace falls back safely', () => {
  const s = createOrganizationSession()
  command(s, 'member.update', { id: 'bao', role: 'member', revoke: true })
  s.sessions.get('demo').data.user = { id: 'bao', name: 'Bảo' }
  assert.equal(read(s).errors[0].code, 'revoked')
  const fresh = createOrganizationSession()
  command(fresh, 'workspace.archive', { id: 'lab' })
  assert.equal(read(fresh, { workspaceId: 'lab' }).context.workspaceId, 'product')
  assert.equal(read(fresh, { workspaceId: 'foreign' }).errors[0].code, 'forbidden')
})
