// Repeatable local data for browser review of Users, Roles, Profile and auth flows.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const path = process.env.KET_VISUAL_SQLITE
if (!path) throw new Error('set KET_VISUAL_SQLITE to a new SQLite file')
if (existsSync(path)) throw new Error(`refusing to replace existing visual database: ${path}`)

const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(path)
await adapter.open()
await migrateOne(adapter, manifest)
registerFunctions(modules)

const scope = {
  company: 'default',
  companies: ['default', 'globex'],
  branch: 'root:default',
  branches: ['root:default', 'default:hanoi', 'root:globex'],
}
const call = async (name: string, args: Record<string, unknown>, actor?: string) => {
  const result = await callFn(name, args, { adapter, manifest, scope, actor })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

try {
  for (const company of [
    { id: 'default', code: 'KET', name: 'Công ty Cổ phần Kết Việt', currency: 'VND' },
    { id: 'globex', code: 'GLX', name: 'Globex Corporation', currency: 'USD' },
  ]) {
    await call('partner.savePartner', {
      id: `${company.id}:partner`,
      kind: 'company',
      name: company.name,
      ref: company.code,
    })
    await call('company.saveCompany', {
      id: company.id,
      code: company.code,
      partnerId: `${company.id}:partner`,
      currency: company.currency,
    })
  }
  await call('company.saveBranch', {
    id: 'default:hanoi',
    companyId: 'default',
    code: 'HN',
    name: 'Văn phòng Hà Nội',
    parentId: 'root:default',
  })

  const users = [
    {
      id: 'visual-admin',
      login: 'admin',
      password: 'identity-demo',
      name: 'Nguyễn Quản Trị',
      email: 'admin@ketviet.example',
      superuser: true,
      accessKind: 'internal',
    },
    {
      id: 'backup-admin',
      login: 'backup.admin',
      password: 'identity-demo',
      name: 'Trần Minh Anh',
      email: 'minhanh@ketviet.example',
      superuser: true,
      accessKind: 'internal',
    },
    {
      id: 'sales-manager',
      login: 'sales.manager',
      password: 'identity-demo',
      name: 'Lê Thu Hà',
      email: 'thuha@ketviet.example',
      accessKind: 'internal',
    },
    {
      id: 'warehouse-user',
      login: 'warehouse.user',
      password: 'identity-demo',
      name: 'Phạm Quang Huy',
      email: 'quanghuy@ketviet.example',
      accessKind: 'internal',
    },
    {
      id: 'invited-user',
      login: 'invited.user',
      name: 'Vũ Khánh Linh',
      email: 'khanhlinh@ketviet.example',
      accessKind: 'internal',
    },
    {
      id: 'portal-contact',
      login: 'portal.contact',
      password: 'identity-demo',
      name: 'Portal Contact',
      email: 'portal@example.test',
      accessKind: 'portal',
    },
  ]
  for (const user of users) {
    await call('user.createUser', user)
    await call('user.grantCompany', {
      id: `${user.id}:default`,
      userId: user.id,
      companyId: 'default',
    })
  }
  for (const userId of ['visual-admin', 'backup-admin', 'sales-manager']) {
    await call('user.grantCompany', { id: `${userId}:globex`, userId, companyId: 'globex' })
    await call('user.grantBranch', {
      id: `${userId}:default:hanoi`,
      userId,
      branchId: 'default:hanoi',
    })
  }

  await call('user.applyPreset', { module: 'sale', level: 'manager' })
  await call('user.applyPreset', { module: 'stock', level: 'user' })
  await call('user.assignRole', {
    id: 'sales-manager:sale-manager',
    userId: 'sales-manager',
    roleId: 'preset:sale:manager',
  })
  await call('user.assignRole', {
    id: 'warehouse-user:stock-user',
    userId: 'warehouse-user',
    roleId: 'preset:stock:user',
  })
  await call(
    'user.recordSecurityEvent',
    { event: 'login.success', userId: 'visual-admin', networkFingerprint: 'visual-demo' },
    'visual-admin',
  )

  console.log(`user/auth visual database ready: ${path}`)
  console.log('sign in with admin / identity-demo')
} finally {
  await (adapter as Adapter).close()
}
