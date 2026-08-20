// Repeatable local data for browser review of the partner screens.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter } from 'ketjs'
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

const scope = { company: 'default', companies: ['default'], branches: null }
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await callFn(name, args, { adapter, manifest, scope })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

try {
  await call('partner.savePartner', {
    id: 'ket-company',
    kind: 'company',
    name: 'Công ty Cổ phần Kết Việt',
    vat: '0312345678',
    email: 'hello@ketviet.example',
    phone: '+84 28 7300 7788',
  })
  await call('company.saveCompany', {
    id: 'default',
    partnerId: 'ket-company',
    currency: 'VND',
  })
  await call('user.createUser', {
    id: 'visual-admin',
    login: 'admin',
    password: 'partner-demo',
    name: 'Quản trị hệ thống',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'visual-admin:default',
    userId: 'visual-admin',
    companyId: 'default',
  })

  const partners = [
    {
      id: 'minh-an',
      kind: 'company',
      name: 'Công ty TNHH Minh An',
      ref: 'KH-00018',
      vat: '0101234567',
      email: 'ketoan@minhan.example',
      phone: '024 3765 4321',
      roles: ['customer'],
    },
    {
      id: 'viet-phat',
      kind: 'company',
      name: 'Nhà cung cấp Việt Phát',
      ref: 'NCC-00007',
      vat: '0317654321',
      email: 'sales@vietphat.example',
      phone: '028 3822 1100',
      roles: ['supplier'],
    },
    {
      id: 'hoang-lan',
      kind: 'person',
      name: 'Hoàng Ngọc Lan',
      ref: 'LH-00126',
      email: 'lan@minhan.example',
      phone: '0903 456 789',
      parentId: 'minh-an',
      roles: ['employee'],
    },
    {
      id: 'an-khang',
      kind: 'company',
      name: 'Công ty An Khang',
      ref: 'KH-00023',
      email: 'contact@ankhang.example',
      phone: '0236 388 8899',
      roles: ['customer', 'supplier'],
    },
  ]
  for (const partner of partners) {
    const { roles, ...values } = partner
    await call('partner.savePartner', values)
    for (const role of roles)
      await call('partner.grantRole', { id: `${partner.id}:${role}`, partnerId: partner.id, role })
  }

  await call('partner.saveAddress', {
    id: 'minh-an:invoice',
    partnerId: 'minh-an',
    use: 'invoice',
    street: '18 Lý Thường Kiệt',
    street2: 'Tầng 6, Tòa nhà Minh An',
    city: 'Hà Nội',
    country: 'VN',
    zip: '100000',
    isDefault: true,
  })
  await call('partner.saveAddress', {
    id: 'minh-an:delivery',
    partnerId: 'minh-an',
    use: 'delivery',
    street: '125 Nguyễn Văn Linh',
    city: 'Hải Phòng',
    country: 'VN',
    isDefault: true,
  })
  await call('partner.saveTerms', {
    id: 'minh-an:terms',
    partnerId: 'minh-an',
    creditLimit: '500000000',
    note: 'Đối chiếu công nợ vào ngày cuối cùng mỗi tháng.',
  })
  await call('account.saveAccount', {
    id: 'receivable',
    code: '131',
    name: 'Phải thu khách hàng',
    accountType: 'asset_receivable',
  })
  await call('account.saveAccount', {
    id: 'payable',
    code: '331',
    name: 'Phải trả nhà cung cấp',
    accountType: 'liability_payable',
  })
  await call('account.savePaymentTerm', { id: 'net30', name: 'Thanh toán trong 30 ngày' })
  await call('account_partner.saveAccountingTerms', {
    id: 'minh-an:accounting',
    partnerId: 'minh-an',
    paymentTermId: 'net30',
    receivableAccountId: 'receivable',
    payableAccountId: 'payable',
  })

  console.log(`partner visual database ready: ${path}`)
  console.log('sign in with admin / partner-demo')
} finally {
  await (adapter as Adapter).close()
}
