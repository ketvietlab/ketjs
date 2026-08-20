import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/app.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-product-list-e2e-'))
const database = join(runtime, 'product.sqlite')
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
  await call('user.createUser', {
    id: 'product-list-admin',
    login: 'admin',
    password: 'product-demo',
    name: 'Quản trị sản phẩm',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'product-list-admin:default',
    userId: 'product-list-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'product-list-admin:root:default',
    userId: 'product-list-admin',
    branchId: 'root:default',
  })
  await call('uom.saveUnit', {
    id: 'unit',
    name: 'Cái',
    relativeFactor: '1',
    sequence: 10,
    active: true,
  })
  await call('product.saveCategory', { id: 'workwear', name: 'Đồng phục vận hành' })

  for (let index = 1; index <= 32; index += 1) {
    const suffix = String(index).padStart(2, '0')
    await call('product.saveTemplate', {
      id: `sample-${suffix}`,
      name: index === 1 ? 'Áo khoác vận hành KETSUITE' : `Sản phẩm mẫu ${suffix}`,
      type: index % 7 === 0 ? 'service' : 'goods',
      categoryId: 'workwear',
      uomId: 'unit',
      description: `Dữ liệu kiểm tra danh sách số ${suffix}.`,
      listPrice: String(100000 + index * 17500),
      saleOk: true,
      purchaseOk: index % 7 !== 0,
    })
  }
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
      KET_SECRET: 'product-list-e2e-secret',
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
