// A ledger with two months in it, served over real HTTP for the browser suite.
//
// The overview compares a window against the one before it, so a fixture with a
// single month in it would render every comparison as "no period to compare" —
// the one state that hides the thing the screen exists to show. May trades and
// June trades better, one May bill falls due inside June, and one June receipt
// part-settles a May invoice, so the aging has something in both buckets.
//
// Dates are fixed rather than relative to today: a screenshot taken on the last
// day of a month must look like the one taken on the first.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/deployment.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-accounting-e2e-'))
const database = join(runtime, 'accounting.sqlite')
const storage = join(runtime, 'storage')
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
    id: 'accounting-admin-partner',
    kind: 'person',
    name: 'Quản trị kế toán',
    email: 'accounting-admin@ket.local',
  })
  await call('user.createUser', {
    id: 'accounting-admin',
    login: 'admin',
    password: 'accounting-demo',
    name: 'Quản trị kế toán',
    partnerId: 'accounting-admin-partner',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'accounting-admin:default',
    userId: 'accounting-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'accounting-admin:root:default',
    userId: 'accounting-admin',
    branchId: 'root:default',
  })

  // The statutory chart, journals, taxes and terms, exactly as a real company
  // gets them: the fixture must not invent an account the TT99 pack does not have.
  await call('account.initializeCompany', {})
  const accounts = await call('account.listAccounts', {})
  const journals = await call('account.listJournals', {})
  const terms = await call('account.listPaymentTerms', {})
  const byCode = (code) => {
    const found = accounts.find((row) => String(row.code) === code)
    if (!found) throw new Error(`the TT99 chart has no account ${code}`)
    return String(found.id)
  }
  const journalOf = (type) => {
    const found = journals.find((row) => String(row.type) === type)
    if (!found) throw new Error(`no ${type} journal was installed`)
    return String(found.id)
  }
  const net30 = String(terms[0]?.id ?? '')

  for (const [id, name] of [
    ['customer-abc', 'Công ty TNHH Thương mại ABC'],
    ['customer-xyz', 'Công ty Cổ phần XYZ'],
    ['supplier-anphat', 'Công ty VLXD An Phát'],
    ['supplier-tinthanh', 'Công ty Điện Máy Tín Thành'],
  ])
    await call('partner.savePartner', { id, kind: 'company', name })

  const invoice = async ({
    id,
    moveType,
    partnerId,
    invoiceDate,
    lineAccountId,
    counterpartAccountId,
    price,
  }) => {
    await call('account.createInvoice', {
      id,
      journalId: journalOf(moveType === 'out_invoice' ? 'sale' : 'purchase'),
      moveType,
      partnerId,
      invoiceDate,
      ...(net30 ? { paymentTermId: net30 } : {}),
      description: id,
      quantity: '1',
      priceUnit: String(price),
      lineAccountId,
      counterpartAccountId,
    })
    await call('account.postMove', { id })
  }

  const entry = async (id, date, lines) => {
    await call('account.createMove', { id, journalId: journalOf('general'), date })
    for (const [lineId, accountId, debit, credit] of lines)
      await call('account.addMoveLine', {
        id: lineId,
        moveId: id,
        name: lineId,
        accountId,
        debit: String(debit),
        credit: String(credit),
      })
    await call('account.postMove', { id })
  }

  const revenue = byCode('511')
  const cogs = byCode('632')
  // Two expense accounts, so the breakdown has more than one bar to rank.
  const staff = byCode('6421')
  const services = byCode('6427')
  const receivable = byCode('1311')
  const payable = byCode('3311')
  const bank = byCode('112')
  const stock = byCode('156')
  const capital = byCode('41111')

  await entry('opening', '2026-05-01T00:00:00.000Z', [
    ['opening:stock', stock, 2_400_000_000, 0],
    ['opening:bank', bank, 600_000_000, 0],
    ['opening:capital', capital, 0, 3_000_000_000],
  ])

  await invoice({
    id: 'may-abc',
    moveType: 'out_invoice',
    partnerId: 'customer-abc',
    invoiceDate: '2026-05-12T00:00:00.000Z',
    lineAccountId: revenue,
    counterpartAccountId: receivable,
    price: 1_240_000_000,
  })
  await invoice({
    id: 'may-bill',
    moveType: 'in_invoice',
    partnerId: 'supplier-anphat',
    invoiceDate: '2026-05-14T00:00:00.000Z',
    lineAccountId: staff,
    counterpartAccountId: payable,
    price: 186_000_000,
  })
  await entry('may-cogs', '2026-05-12T00:00:00.000Z', [
    ['may-cogs:cost', cogs, 742_000_000, 0],
    ['may-cogs:stock', stock, 0, 742_000_000],
  ])

  // June, spread across the month so the line has a shape rather than a spike.
  for (const [id, partnerId, day, price] of [
    ['june-abc-1', 'customer-abc', '04', 610_000_000],
    ['june-xyz-1', 'customer-xyz', '09', 388_000_000],
    ['june-abc-2', 'customer-abc', '16', 742_000_000],
    ['june-xyz-2', 'customer-xyz', '23', 455_000_000],
    ['june-abc-3', 'customer-abc', '29', 256_000_000],
  ])
    await invoice({
      id,
      moveType: 'out_invoice',
      partnerId,
      invoiceDate: `2026-06-${day}T00:00:00.000Z`,
      lineAccountId: revenue,
      counterpartAccountId: receivable,
      price,
    })
  await entry('june-cogs', '2026-06-16T00:00:00.000Z', [
    ['june-cogs:cost', cogs, 1_320_000_000, 0],
    ['june-cogs:stock', stock, 0, 1_320_000_000],
  ])
  await invoice({
    id: 'june-bill',
    moveType: 'in_invoice',
    partnerId: 'supplier-tinthanh',
    invoiceDate: '2026-06-11T00:00:00.000Z',
    lineAccountId: staff,
    counterpartAccountId: payable,
    price: 214_000_000,
  })

  await invoice({
    id: 'june-services',
    moveType: 'in_invoice',
    partnerId: 'supplier-anphat',
    invoiceDate: '2026-06-18T00:00:00.000Z',
    lineAccountId: services,
    counterpartAccountId: payable,
    price: 96_000_000,
  })

  // A part payment against the May invoice: it stays open, and stays overdue,
  // which is the case an aging built from invoice totals gets wrong.
  const open = await call('account.listOpenItems', { partnerId: 'customer-abc' })
  const mayLine = open.find((line) => String(line.moveId) === 'may-abc')
  if (!mayLine) throw new Error('the May invoice left no open item to settle')
  await call('account.registerPayment', {
    id: 'june-receipt',
    name: 'BC/2026/0001',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer-abc',
    journalId: journalOf('bank'),
    destinationAccountId: String(mayLine.accountId),
    amount: '880000000',
    date: '2026-06-20T00:00:00.000Z',
    reconcileLineId: String(mayLine.id),
  })

  // One draft, never posted. Nothing on the overview may move for it.
  await call('account.createInvoice', {
    id: 'june-draft',
    journalId: journalOf('sale'),
    moveType: 'out_invoice',
    partnerId: 'customer-xyz',
    invoiceDate: '2026-06-27T00:00:00.000Z',
    description: 'Chưa ghi sổ',
    quantity: '1',
    priceUnit: '9000000000',
    lineAccountId: revenue,
    counterpartAccountId: receivable,
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
      KET_STORAGE_DIR: storage,
      KET_SECRET: 'accounting-e2e-secret',
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
