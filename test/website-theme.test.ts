import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { namespacedStorage, storageFromConfig } from '@ketvietlab/ketjs'
import type { Row, Storage } from '@ketvietlab/ketjs'
import { checkThemePackage, installThemePackage } from '@ketvietlab/ketsuite'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const manifest = (extra: Row = {}) => ({
  engine: 'website-theme/1',
  key: 'acme',
  version: '1.0.0',
  tier: 'private',
  title: 'Acme',
  settings: { tone: { type: 'enum', values: ['warm', 'cool'], default: 'warm' } },
  script: { entry: 'theme.mjs' },
  ...extra,
})
const CSS = `[data-site-theme="acme"] .wt-theme-header { background: url(logo.svg) }
@media (min-width: 40rem) { [data-site-theme="acme"] main { padding: 2rem } }
@keyframes acme-fade { from { opacity: 0 } to { opacity: 1 } }
@font-face { font-family: Acme; src: url("brand.woff2") format("woff2") }
[data-site-theme="acme"] { & .wt-public-post { color: navy } }`
const MODULE = 'export function mount(root, ctx) { root.dataset.mounted = ctx.settings.tone }\n'
const files = (overrides: Record<string, string | null> = {}, theme: Row = manifest()) => {
  const all: Record<string, string | null> = {
    'theme.json': JSON.stringify(theme),
    'theme.css': CSS,
    'theme.mjs': MODULE,
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'brand.woff2': 'woff2',
    ...overrides,
  }
  return Object.fromEntries(
    Object.entries(all).flatMap(([name, text]) => (text === null ? [] : [[name, bytes(text)]])),
  ) as Record<string, Uint8Array>
}
const codes = (result: ReturnType<typeof checkThemePackage>) =>
  result.ok ? [] : result.errors.map((e) => e.code)

test('a theme package is refused for every way it could reach outside its own site root', () => {
  assert.equal(checkThemePackage(files()).ok, true, JSON.stringify(codes(checkThemePackage(files()))))
  const refused: Array<[string, Record<string, string | null>, Row?]> = [
    ['cssScope', { 'theme.css': '.wt-site { color: red }' }],
    ['cssScope', { 'theme.css': '[data-site-theme="other"] p { color: red }' }],
    ['cssScope', { 'theme.css': '[data-site-theme="acme"] + footer { color: red }' }],
    ['cssScope', { 'theme.css': '[data-site-theme="acme"] p, body { color: red }' }],
    ['cssScope', { 'theme.css': '[data-site-theme="acme"] { & ~ p { color: red } }' }],
    ['cssImport', { 'theme.css': '@import url(logo.svg);' }],
    ['cssUrl', { 'theme.css': '[data-site-theme="acme"] p { background: url(https://cdn.example/x.png) }' }],
    [
      'cssUrl',
      { 'theme.css': '[data-site-theme="acme"] p { background: url("data:image/png;base64,AAAA") }' },
    ],
    ['cssUrl', { 'theme.css': '[data-site-theme="acme"] p { background: url(missing.png) }' }],
    ['cssAtRule', { 'theme.css': '@property --x { syntax: "*"; inherits: true }' }],
    ['cssKeyframes', { 'theme.css': '@keyframes fade { from { opacity: 0 } }' }],
    ['cssSyntax', { 'theme.css': '[data-site-theme="acme"] p { color: red /* open' }],
    ['scriptBudget', { 'theme.mjs': `export const x = '${randomBytes(200_000).toString('base64')}'` }],
    ['frameUnsupported', {}, manifest({ frame: ['header'] })],
    ['fileType', { 'frame-header.ktl': '<header></header>' }],
    ['fileName', { 'Theme.CSS': 'x' }],
    ['fileName', { '_boot.mjs': 'export {}' }],
    ['scriptUndeclared', {}, manifest({ script: undefined })],
    ['manifestTier', {}, manifest({ tier: 'bundled' })],
    [
      'manifestOrigin',
      {},
      manifest({ script: { entry: 'theme.mjs', connect: ['http://insecure.example'] } }),
    ],
    ['manifestUnknownKey', {}, manifest({ hooks: ['server'] })],
    ['stylesheetMissing', { 'theme.css': null }],
  ]
  for (const [code, overrides, theme] of refused) {
    const result = checkThemePackage(files(overrides, theme ?? manifest()))
    assert.ok(
      codes(result).includes(code),
      `${code} expected for ${JSON.stringify(overrides)}: ${codes(result)}`,
    )
  }
})

test('an installed theme is offered, chosen, published and served from tenant storage', async (t) => {
  let base: Storage | null = null
  const { app, fixture, revision } = await bootWebsiteStudio(undefined, {
    openStorage: (config) => (base = storageFromConfig(config)),
  })
  t.after(() => app.close())
  // The installer writes where the server reads: the deployment's storage, namespaced as the server does.
  const install = (packageFiles: Record<string, Uint8Array>, company = 'studio-a') =>
    installThemePackage(
      {
        storage: namespacedStorage(base!, 'ketsuite'),
        call: async (fn, input) =>
          (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value,
      },
      packageFiles,
    )
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const send = async (client: typeof designer, fn: string, input: Row) => {
    const response = await client.post(`/_ket/fn/${fn}`, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, value: ((await response.json()) as { value: Row }).value }
  }

  const installed = await install(files())
  assert.equal(installed.ok, true, JSON.stringify(installed))
  if (!installed.ok) return
  assert.equal(installed.status, 'installed')
  const versionId = installed.id
  assert.deepEqual(await install(files()), installed, 'the same package is the same version')
  const conflict = await install(files({ 'theme.css': '[data-site-theme="acme"] p { color: red }' }))
  assert.equal(conflict.ok, false, 'a version once installed never changes')

  const anonymous = app.client.anonymous()
  // Installed is not yet offered: neither served nor selectable.
  assert.equal((await anonymous.get(`/_theme/${versionId}/theme.css`)).status, 404)
  await fixture('user.applyRoleTemplate', {
    roleId: 'studio-themes',
    templateKey: 'website.themes',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'apply-themes',
  })
  await fixture('user.assignScopedRole', {
    id: 'designer-themes',
    userId: 'studio-designer',
    roleId: 'studio-themes',
    scopeKind: 'company',
    companyId: 'studio-a',
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'designer-themes',
  })
  const select = (client: typeof designer, input: Row) =>
    send(client, 'website_theme.selectTheme', { siteId: 'site-a', expectedRevisionId: 'initial', ...input })
  assert.equal((await select(designer, { versionId })).value.ok, false)
  await fixture('website_theme.setThemeVersionStatus', { id: versionId, status: 'available' }, 'studio-a')

  // The page before any theme: no policy header, no theme root.
  await fixture('website.saveDomain', {
    id: 'theme-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const publish = async () => {
    const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
    await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: entry.revisionId })
  }
  await publish()
  const plain = await anonymous.get('/')
  assert.equal(plain.headers.get('content-security-policy'), null)
  assert.doesNotMatch(await plain.text(), /data-site-theme/)

  const listed = await send(designer, 'website_theme.listThemes', { siteId: 'site-a' })
  assert.equal(listed.status, 200, JSON.stringify(listed))
  assert.ok((listed.value.themes as Row[]).some((theme) => theme.id === versionId && theme.key === 'acme'))
  assert.equal((await select(editor, { versionId })).status, 403)
  assert.equal((await select(designer, { versionId, settings: { tone: 'loud' } })).value.ok, false)
  assert.equal((await select(designer, { versionId, settings: { other: 'x' } })).value.ok, false)
  const chosen = await select(designer, { versionId, settings: { tone: 'cool' } })
  assert.equal(chosen.value.ok, true, JSON.stringify(chosen))
  // Another company cannot reach this company's version.
  const foreign = await app.fixture.call<Row>(
    'website_theme.selectTheme',
    { siteId: 'site-b', expectedRevisionId: 'initial', versionId },
    { scope: { company: 'studio-b', branches: null } },
  )
  assert.equal(foreign.value.ok, false)
  // A later style save merges its keys and keeps the theme.
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: chosen.value.revisionId,
    values: { footer: 'Themed footer' },
  })
  assert.doesNotMatch(await (await anonymous.get('/')).text(), /data-site-theme/, 'a draft is not live')
  await publish()

  const page = await anonymous.get('/')
  const html = await page.text()
  const policy = page.headers.get('content-security-policy') ?? ''
  assert.match(policy, /script-src 'self'(;|$)/)
  assert.match(policy, /base-uri 'none'/)
  assert.match(html, /data-site-theme="acme"/)
  assert.match(html, /Themed footer/)
  assert.ok(html.includes(`href="/_theme/${versionId}/theme.css"`))
  assert.ok(html.includes(`src="/_theme/${versionId}/_boot.mjs"`))
  assert.match(html, /<script type="application\/json" id="ket-theme-data">\{"settings":\{"tone":"cool"\}/)

  // A staff session on the same host gets the stylesheet but never the theme's code.
  const staff = await (await designer.get('/')).text()
  assert.ok(staff.includes(`/_theme/${versionId}/theme.css`))
  assert.ok(!staff.includes('_boot.mjs'))

  const css = await anonymous.get(`/_theme/${versionId}/theme.css`)
  assert.equal(css.status, 200)
  assert.equal(await css.text(), CSS)
  assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff')
  assert.match(css.headers.get('content-type') ?? '', /^text\/css/)
  const boot = await anonymous.get(`/_theme/${versionId}/_boot.mjs`)
  assert.equal(boot.status, 200)
  assert.match(await boot.text(), /import \* as theme from '\.\/theme\.mjs'/)
  assert.equal((await anonymous.get(`/_theme/${versionId}/theme.mjs`)).status, 200)
  assert.equal((await anonymous.get(`/_theme/${versionId}/missing.css`)).status, 404)
  assert.equal((await anonymous.get(`/_theme/${versionId}/..%2Ftheme.css`)).status, 404)

  const robots = await (await anonymous.get('/robots.txt')).text()
  assert.match(robots, /^Allow: \/_theme\/$/m)
  assert.doesNotMatch(robots, /Disallow: \/_theme/)

  // Revocation is immediate at the origin; the page stays as published and simply loses the files.
  // As `ket provision` runs it: an operator with no company, finding the version by id.
  const revoked = await app.fixture.call<Row>(
    'website_theme.setThemeVersionStatus',
    { id: versionId, status: 'revoked' },
    { scope: { company: null, branches: null } },
  )
  assert.equal(revoked.value.status, 'revoked', JSON.stringify(revoked.value))
  assert.equal((await anonymous.get(`/_theme/${versionId}/theme.css`)).status, 404)
  assert.equal((await anonymous.get(`/_theme/${versionId}/_boot.mjs`)).status, 404)
  assert.equal((await anonymous.get('/')).status, 200)
})
