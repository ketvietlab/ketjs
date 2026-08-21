import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/app.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-website-backend-e2e-'))
const database = join(runtime, 'website.sqlite')
const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : []), ...(ketsuite.themes ?? [])]
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

const seedIdentity = async () => {
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
    id: 'website-admin-partner',
    kind: 'person',
    name: 'Quản trị website',
    email: 'website-admin@ket.local',
  })
  await call('user.createUser', {
    id: 'website-admin',
    login: 'admin',
    password: 'website-demo',
    name: 'Quản trị website',
    partnerId: 'website-admin-partner',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'website-admin:default',
    userId: 'website-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'website-admin:root:default',
    userId: 'website-admin',
    branchId: 'root:default',
  })
}

const seedSite = async ({ id, title, locale, theme, host, entryId, layout }) => {
  await call('website.saveSite', {
    id,
    name: title,
    title,
    defaultLocale: locale,
    theme,
    active: true,
  })
  await call('website.saveSiteMember', {
    id: `${id}:website-admin`,
    siteId: id,
    userId: 'website-admin',
    role: 'administrator',
  })
  await call('website.saveDomain', {
    id: `${id}-domain`,
    siteId: id,
    host,
    primary: true,
  })
  await call('website.saveEntry', {
    id: entryId,
    siteId: id,
    type: 'website.page',
    slug: 'home',
    path: '/',
    title,
    excerpt: `Trang chủ ${title}`,
    layout,
    fields: {},
  })
  await call('website.publishEntry', { id: entryId })
}

const seed = async () => {
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await seedIdentity()
  await seedSite({
    id: 'hospitality-site',
    title: 'Mây Retreat',
    locale: 'vi',
    theme: 'theme_hospitality',
    host: '127.0.0.1',
    entryId: 'home-hospitality',
    layout: [
      {
        type: 'website.hero',
        settings: {
          heading: 'Một khoảng nghỉ thật sự',
          subheading: 'Nằm giữa rừng thông và những buổi sáng chậm rãi.',
          ctaLabel: 'Khám phá phòng',
          ctaHref: '#stays',
        },
      },
      { type: 'website_hospitality.stays', settings: { heading: 'Ở lại theo cách của bạn', limit: 6 } },
      { type: 'website_hospitality.booking', settings: { heading: 'Ngày nào phù hợp với bạn?' } },
    ],
  })
  await seedSite({
    id: 'retail-site',
    title: 'Kết Goods',
    locale: 'en',
    theme: 'theme_retail',
    host: 'localhost',
    entryId: 'home-retail',
    layout: [
      {
        type: 'website.hero',
        settings: {
          heading: 'Useful things. Better made.',
          subheading: 'A compact edit for the everyday.',
          ctaLabel: 'Shop the edit',
          ctaHref: '#products',
        },
      },
      { type: 'website_retail.products', settings: { heading: 'The everyday edit', limit: 8 } },
      {
        type: 'website_retail.cart',
        settings: { heading: 'Keep what caught your eye', checkoutLabel: 'Open bag' },
      },
    ],
  })
  await call('website.saveTerm', {
    id: 'journal',
    siteId: 'hospitality-site',
    taxonomy: 'website.category',
    slug: 'journal',
    name: 'Nhật ký khu nghỉ',
  })
  await call('website.saveMediaMetadata', {
    id: 'hero-media',
    siteId: 'hospitality-site',
    attachmentId: 'hero-image',
    alt: 'Rừng thông quanh khu nghỉ',
    width: 1920,
    height: 1280,
  })
  await call('website_menu.addMenuItem', {
    id: 'menu-home',
    siteId: 'hospitality-site',
    label: 'Trang chủ',
    href: '/',
    position: 10,
  })
  await call('website_menu.addMenuItem', {
    id: 'menu-stays',
    siteId: 'hospitality-site',
    label: 'Hạng phòng',
    href: '/stays',
    position: 20,
  })
  await call('website_form.saveForm', {
    id: 'contact-form',
    siteId: 'hospitality-site',
    name: 'Yêu cầu tư vấn',
    schema: {
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'email', type: 'email', required: true },
      ],
    },
    successMessage: 'Cảm ơn bạn. Chúng tôi sẽ liên hệ sớm.',
    active: true,
  })
  await call('website_form.submitForm', {
    formId: 'contact-form',
    payload: { name: 'Minh Anh', email: 'minhanh@example.test' },
    consent: true,
    source: '/',
    rateKey: 'seed',
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
      KET_SECRET: 'website-backend-e2e-secret',
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
