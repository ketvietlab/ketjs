import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/deployment.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-loyalty-tier-e2e-'))
const database = join(runtime, 'loyalty.sqlite')
const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(database)
const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}

const call = async (name, input) => {
  const result = await callFn(name, input, { adapter, manifest, scope })
  if (result.value?.ok === false) throw new Error(`${name}: ${JSON.stringify(result.value.errors)}`)
  return result.value
}

const seed = async () => {
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', {
    id: 'ket-company',
    kind: 'company',
    name: 'Công ty Cổ phần Kết Việt',
    ref: 'KET',
  })
  await call('company.saveCompany', {
    id: 'default',
    code: 'KET',
    partnerId: 'ket-company',
    currency: 'VND',
  })
  await call('partner.savePartner', {
    id: 'loyalty-admin-partner',
    kind: 'person',
    name: 'Quản trị khách hàng thân thiết',
    email: 'loyalty-admin@ket.local',
  })
  await call('user.createUser', {
    id: 'loyalty-admin',
    login: 'admin',
    password: 'loyalty-demo',
    name: 'Quản trị khách hàng thân thiết',
    partnerId: 'loyalty-admin-partner',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'loyalty-admin:default',
    userId: 'loyalty-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'loyalty-admin:root:default',
    userId: 'loyalty-admin',
    branchId: 'root:default',
  })
  await call('loyalty.program.save', {
    id: 'ket-club',
    name: 'Két Club',
    programType: 'loyalty',
    appliesOn: 'current',
    trigger: 'auto',
    currency: 'VND',
    pointName: 'Két Point',
    availableSale: true,
    availablePos: true,
    portalVisible: true,
  })
  for (const tier of [
    {
      id: 'member',
      name: 'Thành viên',
      code: 'member',
      sequence: 10,
      minimumSpend: '0',
      windowMonths: 120,
      redeemPercent: '10',
    },
    {
      id: 'silver',
      name: 'Bạc',
      code: 'silver',
      sequence: 20,
      minimumSpend: '5000000',
      windowMonths: 12,
      redeemPercent: '20',
    },
    {
      id: 'gold',
      name: 'Vàng',
      code: 'gold',
      sequence: 30,
      minimumSpend: '20000000',
      windowMonths: 12,
      redeemPercent: '30',
    },
    {
      id: 'diamond',
      name: 'Kim cương',
      code: 'diamond',
      sequence: 40,
      minimumSpend: '50000000',
      windowMonths: 12,
      redeemPercent: '40',
    },
  ])
    await call('loyalty.tier.save', tier)
  await adapter.close()
}

await seed()
const child = spawn(
  process.execPath,
  ['packages/ketjs/dist/cli.js', 'serve', '--workspace', '.build/ket.workspace.js', '--port', '4173'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      KET_SQLITE: database,
      KET_SECRET: 'loyalty-tier-e2e-secret',
      KET_LOCALE: 'vi',
      KET_FALLBACK_LOCALE: 'vi',
    },
  },
)

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => {
  rmSync(runtime, { recursive: true, force: true })
  process.exit(code ?? 0)
})
