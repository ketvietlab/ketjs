import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/app.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-stock-inventory-e2e-'))
const database = join(runtime, 'stock.sqlite')
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
    id: 'stock-admin-partner',
    kind: 'person',
    name: 'Quản trị kho',
    email: 'stock-admin@ket.local',
  })
  await call('user.createUser', {
    id: 'stock-admin',
    login: 'admin',
    password: 'stock-demo',
    name: 'Quản trị kho',
    partnerId: 'stock-admin-partner',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'stock-admin:default',
    userId: 'stock-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'stock-admin:root:default',
    userId: 'stock-admin',
    branchId: 'root:default',
  })
  await call('uom.saveUnit', {
    id: 'unit',
    name: 'Cái',
    relativeFactor: '1',
    sequence: 10,
    active: true,
  })
  await call('product.saveTemplate', {
    id: 'stock-template',
    name: 'Áo khoác kiểm kê KETSUITE',
    type: 'goods',
    uomId: 'unit',
    listPrice: '1299000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'stock-variant',
    templateId: 'stock-template',
    defaultCode: 'STOCK-JACKET',
    barcode: '8938500000200',
  })
  await call('stock.configureProduct', {
    templateId: 'stock-template',
    isStorable: true,
    tracking: 'none',
  })
  await call('stock.saveWarehouse', {
    id: 'wh',
    name: 'Kho trung tâm',
    code: 'WH',
    receptionSteps: 'one_step',
    deliverySteps: 'ship_only',
  })
  await call('stock.saveLocation', {
    id: 'inventory',
    name: 'Điều chỉnh kiểm kê',
    usage: 'inventory',
  })
  await call('stock.adjustInventory', {
    id: 'opening-balance',
    productId: 'stock-variant',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '12',
    productUomId: 'unit',
  })
  await call('stock.createPicking', {
    id: 'transfer-review',
    name: 'WH/OUT/REVIEW',
    pickingTypeId: 'wh:outgoing',
    scheduledDate: '2026-08-21T08:30:00.000Z',
  })
  await call('stock.addMove', {
    id: 'move-review',
    name: 'Áo khoác xuất kho',
    pickingId: 'transfer-review',
    productId: 'stock-variant',
    productUomId: 'unit',
    productUomQty: '3',
  })
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
      KET_SECRET: 'stock-inventory-e2e-secret',
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
