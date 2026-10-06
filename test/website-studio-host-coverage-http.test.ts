import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { coreRoutes } from '../packages/website-client/client/routes.ts'
import { studioPaths } from '../packages/ketsuite/src/modules/website_backend/studio/paths.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const UNSUPPORTED = 'Thao tác không được hỗ trợ.'

test('the host serves every Studio screen the client routes to, and nothing else', () => {
  const client = Object.values(coreRoutes)
    .map((route) => `/website/${route.path.replace(/:([A-Za-z]+)/g, '{$1}')}`)
    .sort()
  assert.deepEqual([...studioPaths].sort(), client)
})

test('every operation the Studio client calls is answered by the host', async (t) => {
  // Every `call('module.fn'` and `call<T>(\n 'module.fn'` in the client, wherever it is written.
  const names = new Set<string>()
  for (const file of globSync('packages/website-client/client/**/*.{ts,tsx}')) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /\bcall(?:<[^(]*?>)?\(\s*'([a-z_]+\.[A-Za-z]+)'/g,
    ))
      names.add(match[1]!)
  }
  assert.ok(names.size > 30, `found ${names.size} operations; the scan no longer sees the client's calls`)
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const call = async (name: string, input: Row) => {
    const response = await designer.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return (await response.json()) as { ok: boolean; message?: string; value: Row }
  }
  const unanswered: string[] = []
  for (const name of [...names].sort()) {
    if ((await call(name, { siteId: 'site-a' })).message === UNSUPPORTED) unanswered.push(name)
  }
  assert.deepEqual(unanswered, [])
  assert.equal((await call('website_studio.publicSite', { siteId: 'site-a' })).message, UNSUPPORTED)

  // "Open the website" goes to the site's own address, once it has one.
  const before = (await call('website_studio.bootstrap', { site: 'site-a' })).value
  assert.equal((before.site as Row).url, '')
  await fixture('website.saveDomain', {
    id: 'coverage-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const after = (await call('website_studio.bootstrap', { site: 'site-a' })).value
  assert.match(String((after.site as Row).url), /^http:\/\/127\.0\.0\.1:\d+$/)
})
