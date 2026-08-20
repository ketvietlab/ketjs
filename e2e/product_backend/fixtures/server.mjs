import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  callFn,
  compose,
  localStorage,
  migrateOne,
  namespacedStorage,
  registerFunctions,
  sqliteAdapter,
} from 'ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/app.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-product-list-e2e-'))
const database = join(runtime, 'product.sqlite')
const storage = join(runtime, 'storage')
const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(database)
const objects = namespacedStorage(localStorage({ dir: storage }), ketsuite.name)
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

const attachment = async ({ id, source, resId, alt, primary = false, sequence }) => {
  const bytes = readFileSync(source)
  const attachmentId = `${id}-attachment`
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/default/${checksum.slice(0, 2)}/${checksum}`
  await objects.put(
    storeKey,
    (async function* () {
      yield bytes
    })(),
    { type: 'image/png', size: bytes.length },
  )
  await call('storage.createAttachment', {
    id: attachmentId,
    name: `${id}.png`,
    resModel: 'product.Template',
    resId,
    resField: 'media',
    kind: 'stored',
    storeKey,
    mimetype: 'image/png',
    size: bytes.length,
    checksum,
    public: false,
    createdAt: '2026-08-20T08:00:00.000Z',
  })
  await call('product_media.attachMedia', {
    id,
    attachmentId,
    templateId: resId,
    alt,
    primary,
    sequence,
  })
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
    id: 'product-list-admin-partner',
    kind: 'person',
    name: 'Quản trị sản phẩm',
    email: 'product-admin@ket.local',
  })
  await call('user.createUser', {
    id: 'product-list-admin',
    login: 'admin',
    password: 'product-demo',
    name: 'Quản trị sản phẩm',
    partnerId: 'product-list-admin-partner',
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
  await call('product.saveAttribute', {
    id: 'color',
    name: 'Màu sắc',
    sequence: 10,
    displayType: 'pills',
    createVariant: 'always',
    active: true,
  })
  await call('product.saveAttributeValue', {
    id: 'color-blue',
    attributeId: 'color',
    name: 'Xanh nghiệp vụ',
    sequence: 10,
  })
  await call('product.saveAttributeValue', {
    id: 'color-orange',
    attributeId: 'color',
    name: 'Cam cảnh báo',
    sequence: 20,
  })
  await call('product.saveTemplate', {
    id: 'tpl-review',
    name: 'Áo khoác vận hành KETSUITE',
    type: 'goods',
    categoryId: 'workwear',
    uomId: 'unit',
    description: 'Sản phẩm fixture dùng để kiểm tra đủ ba tab chi tiết.',
    listPrice: '1299000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('stock.configureProduct', {
    templateId: 'tpl-review',
    isStorable: true,
    tracking: 'lot',
  })
  await call('product.saveVariant', {
    id: 'variant-review',
    templateId: 'tpl-review',
    defaultCode: 'JACKET-REVIEW',
    barcode: '8938500000017',
    weight: '0.65',
    volume: '0.004',
  })
  await attachment({
    id: 'media-primary',
    source: join(root, 'e2e/product_backend/fixtures/product-primary.png'),
    resId: 'tpl-review',
    alt: 'Áo khoác vận hành màu xanh',
    primary: true,
    sequence: 10,
  })
  await attachment({
    id: 'media-secondary',
    source: join(root, 'e2e/product_backend/fixtures/product-secondary.png'),
    resId: 'tpl-review',
    alt: 'Áo khoác vận hành màu cam',
    sequence: 20,
  })

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
      KET_STORAGE_DIR: storage,
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
