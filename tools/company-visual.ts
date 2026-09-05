// Repeatable local data for browser review of Company, Branch and context screens.
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

const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await callFn(name, args, { adapter, manifest, scope })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

try {
  const companies = [
    { id: 'default', code: 'KET', name: 'Công ty Cổ phần Kết Việt', currency: 'VND', parentId: null },
    { id: 'ket-south', code: 'KET-S', name: 'Kết Việt Miền Nam', currency: 'VND', parentId: 'default' },
    { id: 'globex', code: 'GLX', name: 'Globex Corporation', currency: 'USD', parentId: null },
  ]
  for (const company of companies) {
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
      parentId: company.parentId,
      currency: company.currency,
    })
  }

  for (const branch of [
    {
      id: 'default:north',
      companyId: 'default',
      code: 'HN',
      name: 'Văn phòng Hà Nội',
      parentId: 'root:default',
    },
    {
      id: 'default:warehouse',
      companyId: 'default',
      code: 'KHO',
      name: 'Trung tâm phân phối',
      parentId: 'default:north',
    },
    {
      id: 'ket-south:hcm',
      companyId: 'ket-south',
      code: 'HCM',
      name: 'Văn phòng Hồ Chí Minh',
      parentId: 'root:ket-south',
    },
    {
      id: 'globex:west',
      companyId: 'globex',
      code: 'WEST',
      name: 'West Operations',
      parentId: 'root:globex',
    },
  ])
    await call('company.saveBranch', branch)

  await call('user.createUser', {
    id: 'visual-admin',
    login: 'admin',
    password: 'company-demo',
    name: 'Quản trị đa công ty',
    superuser: true,
  })
  for (const company of companies)
    await call('user.grantCompany', {
      id: `visual-admin:${company.id}`,
      userId: 'visual-admin',
      companyId: company.id,
    })
  for (const branchId of ['default:north', 'default:warehouse', 'ket-south:hcm', 'globex:west'])
    await call('user.grantBranch', {
      id: `visual-admin:${branchId}`,
      userId: 'visual-admin',
      branchId,
    })

  console.log(`company visual database ready: ${path}`)
  console.log('sign in with admin / company-demo')
} finally {
  await (adapter as Adapter).close()
}
