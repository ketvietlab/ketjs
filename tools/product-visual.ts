// Disposable local review of the real Product list and record routes.
import { bootDeployment, callFn, type Scope } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'

const port = Number(process.env.PORT ?? 4120)
const app = await bootDeployment(commerce, {
  env: {
    HOST: '127.0.0.1',
    KET_LOG: 'null',
    KET_SQLITE: ':memory:',
    KET_SECRET: 'local-product-design-review',
  },
  port,
  log: () => {},
})
const call = async (name: string, args: Record<string, unknown>, scope: Scope = { company: 'default' }) => {
  const result = await callFn(name, args, {
    adapter: app.adapter!,
    manifest: app.manifest,
    actor: 'system:provision',
    scope,
  })
  const value = result.value as Record<string, unknown>
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return value
}
try {
  const tenant = await call('user.provisionAdmin', {
    companyName: 'Két Việt · Design review',
    companyCode: 'KET',
    currency: 'VND',
    adminLogin: 'admin',
    adminName: 'Quản trị kiểm chứng',
    adminPassword: 'product-demo',
  })
  const scope = { company: String(tenant.companyId), branch: String(tenant.branchId) }
  await call('uom.saveUnit', { id: 'unit', name: 'Cái', relativeFactor: '1' }, scope)
  await call('product.saveCategory', { id: 'uniform', name: 'Đồng phục vận hành' }, scope)
  await call('product.saveCategory', { id: 'equipment', name: 'Thiết bị & vật tư' }, scope)
  const products = [
    ['Áo khoác gió vận hành', '485000', 'uniform'],
    ['Áo polo đồng phục', '245000', 'uniform'],
    ['Quần bảo hộ nhiều túi', '365000', 'uniform'],
    ['Giày bảo hộ chống trượt', '890000', 'equipment'],
    ['Bộ đàm cầm tay', '1250000', 'equipment'],
    ['Mũ bảo hộ công trường', '95000', 'equipment'],
    ['Găng tay chống cắt', '78000', 'equipment'],
    ['Bộ dụng cụ sửa chữa đa năng', '1590000', 'equipment'],
    ['Áo phản quang cho đội vận hành kho và giao nhận tại các chi nhánh miền Nam', '125000', 'uniform'],
    ['Dịch vụ in logo lên đồng phục', '35000', null],
    ['Dịch vụ kiểm định thiết bị', '650000', null],
    ['Thẻ nhân viên kèm dây đeo', '42000', 'equipment'],
  ] as const
  for (const [index, [name, listPrice, categoryId]] of products.entries())
    await call(
      'product.saveTemplate',
      {
        id: `review-product-${index + 1}`,
        name,
        listPrice,
        categoryId,
        type: name.startsWith('Dịch vụ') ? 'service' : 'goods',
        uomId: 'unit',
      },
      scope,
    )
  console.log(`Product review ready: http://127.0.0.1:${port}/admin/product/templates?lang=vi`)
  console.log('Local disposable login: admin / product-demo')
} catch (error) {
  await app.close()
  throw error
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
