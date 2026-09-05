// Repeatable local data for browser review of the CRM screens.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const path = process.env.KET_VISUAL_SQLITE
if (!path) throw new Error('set KET_VISUAL_SQLITE to a new SQLite file')
if (existsSync(path)) throw new Error(`refusing to replace existing visual database: ${path}`)

const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(path)
await adapter.open()
await migrateOne(adapter, manifest)
registerFunctions(modules)

const scope = { company: 'default', companies: ['default'], branches: null }
const call = async (name: string, args: Record<string, unknown>, actor?: string) => {
  const result = await callFn(name, args, { adapter, manifest, scope, ...(actor ? { actor } : {}) })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

const day = (offset: number): string => {
  // Fixed anchor so a reviewer sees the same board on every reseed.
  const base = new Date('2026-08-24T00:00:00.000Z')
  base.setUTCDate(base.getUTCDate() + offset)
  return base.toISOString().slice(0, 10)
}

try {
  await call('partner.savePartner', {
    id: 'ket-company',
    kind: 'company',
    name: 'Công ty Cổ phần Kết Việt',
    email: 'hello@ketviet.example',
  })
  await call('company.saveCompany', { id: 'default', partnerId: 'ket-company', currency: 'VND' })
  for (const [id, login, name] of [
    ['visual-admin', 'admin', 'Quản trị hệ thống'],
    ['visual-sales', 'sales', 'Trần Thu Hà'],
  ] as const)
    await call('user.createUser', {
      id,
      login,
      password: 'crm-demo',
      name,
      defaultCompanyId: 'default',
      superuser: id === 'visual-admin',
    })
  for (const id of ['visual-admin', 'visual-sales'])
    await call('user.grantCompany', { id: `${id}:default`, userId: id, companyId: 'default' })

  const actor = 'visual-admin'
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-visual-defaults' }, actor)
  for (const [id, name, capacity] of [
    ['sales:admin', 'visual-admin', 4],
    ['sales:ha', 'visual-sales', 6],
  ] as const)
    await call(
      'crm.team.member.save',
      {
        id,
        teamId: 'crm-team-sales',
        userId: name,
        capacity,
        sequence: id === 'sales:admin' ? 10 : 20,
        idempotencyKey: `crm-visual-member-${id}`,
      },
      actor,
    )
  for (const [id, name] of [
    ['tag-enterprise', 'Doanh nghiệp lớn'],
    ['tag-inbound', 'Inbound'],
    ['tag-renewal', 'Gia hạn'],
  ] as const)
    await call('crm.tag.save', { id, name }, actor)
  await call(
    'crm.scoreRule.save',
    {
      values: {
        id: 'score-revenue',
        name: 'Doanh thu kỳ vọng',
        field: 'utmSource',
        operator: 'eq',
        value: 'website',
        points: '25',
        sequence: 10,
        active: true,
      },
      idempotencyKey: 'crm-visual-score-1',
    },
    actor,
  )

  const partners = [
    ['minh-an', 'Công ty TNHH Minh An', 'ketoan@minhan.example', '024 3765 4321'],
    ['viet-phat', 'Công ty Việt Phát', 'sales@vietphat.example', '028 3822 1100'],
    ['an-khang', 'Công ty An Khang', 'contact@ankhang.example', '0236 388 8899'],
  ] as const
  for (const [id, name, email, phone] of partners)
    await call('partner.savePartner', { id, kind: 'company', name, email, phone })

  const cases = [
    {
      id: 'lead-minh-an',
      kind: 'lead',
      name: 'Minh An hỏi bảng giá quà tặng',
      partnerId: 'minh-an',
      email: 'ketoan@minhan.example',
      phone: '024 3765 4321',
      priority: '2',
      utmSource: 'website',
      tagIds: ['tag-inbound'],
      expectedRevenue: '48000000',
      probability: '30',
    },
    {
      id: 'lead-duplicate',
      kind: 'lead',
      name: 'Minh An hỏi bảng giá (form website)',
      email: 'ketoan@minhan.example',
      phone: '02437654321',
      priority: '1',
      utmSource: 'website',
      tagIds: ['tag-inbound'],
    },
    {
      id: 'opp-viet-phat',
      kind: 'opportunity',
      name: 'Việt Phát — gói triển khai 2026',
      partnerId: 'viet-phat',
      email: 'sales@vietphat.example',
      assigneeUserId: 'visual-sales',
      priority: '3',
      tagIds: ['tag-enterprise'],
      expectedRevenue: '420000000',
      recurringRevenue: '35000000',
      probability: '65',
      expectedClosing: day(21),
    },
    {
      id: 'opp-an-khang',
      kind: 'opportunity',
      name: 'An Khang — gia hạn dịch vụ',
      partnerId: 'an-khang',
      assigneeUserId: 'visual-admin',
      priority: '2',
      tagIds: ['tag-renewal'],
      expectedRevenue: '96000000',
      probability: '80',
      expectedClosing: day(7),
    },
  ]
  for (const held of cases)
    await call('crm.case.save', { ...held, idempotencyKey: `crm-visual-${held.id}` }, actor)

  await call(
    'crm.case.move',
    {
      id: 'opp-viet-phat',
      stageId: 'crm-stage-proposition',
      expectedVersion: 1,
      idempotencyKey: 'crm-visual-move-1',
    },
    actor,
  )
  await call(
    'crm.case.move',
    {
      id: 'opp-an-khang',
      stageId: 'crm-stage-qualified',
      expectedVersion: 1,
      idempotencyKey: 'crm-visual-move-2',
    },
    actor,
  )
  await call(
    'crm.case.addMessage',
    {
      id: 'note-viet-phat',
      caseId: 'opp-viet-phat',
      body: 'Đã gửi hồ sơ năng lực, hẹn demo tuần sau.',
      visibility: 'internal',
      idempotencyKey: 'crm-visual-note-1',
    },
    actor,
  )
  await call(
    'crm.activity.schedule',
    {
      id: 'activity-demo',
      caseId: 'opp-viet-phat',
      summary: 'Demo sản phẩm cho ban giám đốc',
      dueDate: day(3),
      idempotencyKey: 'crm-visual-activity-1',
    },
    actor,
  )
  await call(
    'crm.activity.schedule',
    {
      id: 'activity-call',
      caseId: 'opp-an-khang',
      summary: 'Gọi xác nhận ngân sách gia hạn',
      dueDate: day(1),
      idempotencyKey: 'crm-visual-activity-2',
    },
    actor,
  )
  await call('crm.gamification.refresh', { idempotencyKey: 'crm-visual-leaderboard' }, actor)

  console.log(`crm visual database ready: ${path}`)
  console.log('sign in with admin / crm-demo')
} finally {
  await (adapter as Adapter).close()
}
