import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import type { StudioDomainPolicy } from '@ketvietlab/ketsuite'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

type Boot = Awaited<ReturnType<typeof bootWebsiteStudio>>

const studioClient = async (app: Boot['app'], login: string) => {
  const client = app.client.anonymous()
  await client.login({ login, password: 'studio-local' })
  const post = async (path: string, input: Row) => {
    const response = await client.post(path, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
  }
  return Object.assign((name: string, input: Row) => post('/website/api/' + name, input), { post })
}

const domainScreens = (designer: Awaited<ReturnType<typeof studioClient>>) => {
  const domain = async (id: string) =>
    (await designer('website_studio.getResource', { siteId: 'site-a', kind: 'domains', id })).value
  return {
    add: (id: string, title: string) =>
      designer('website_studio.saveResource', {
        siteId: 'site-a',
        kind: 'domains',
        id,
        expectedRevisionId: null,
        values: { title },
      }),
    domain,
    verify: async (id: string) =>
      designer('website_studio.verifyDomain', {
        siteId: 'site-a',
        id,
        expectedRevisionId: (await domain(id)).revisionId,
      }),
    switchTo: async (id: string, confirmed: boolean, expectedPrimaryId: unknown) =>
      designer('website_studio.setPrimaryDomain', {
        siteId: 'site-a',
        id,
        expectedRevisionId: (await domain(id)).revisionId,
        expectedPrimaryId,
        confirmed,
      }),
  }
}

/**
 * A site's own domains: the first added is its address, the rest redirect to it. Whoever runs the
 * deployment points the names at it, so a host answers as soon as it is added: nothing to prove.
 */
test('Studio domains: a host the deployment serves itself answers once added', async (t) => {
  const { app } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  const designer = await studioClient(app, 'studio-designer')
  const { add, domain, verify, switchTo } = domainScreens(designer)

  const first = await add('d-main', 'Lanh.Test')
  assert.equal(first.status, 200, String(first.message))
  assert.deepEqual(
    [
      first.value.title,
      first.value.role,
      first.value.state,
      first.value.tls,
      first.value.challenge,
      first.value.route,
    ],
    ['lanh.test', 'primary', 'verified', 'ready', null, null],
  )
  const second = (await add('d-new', 'moi.lanh.test')).value
  assert.deepEqual([second.role, second.state, second.attempts], ['redirect', 'verified', []])
  // A retried add answers with the same domain; a new name under that id is refused.
  assert.equal((await add('d-new', 'moi.lanh.test')).value.revisionId, second.revisionId)
  const renamed = await add('d-new', 'khac.lanh.test')
  assert.equal(renamed.status, 400)
  assert.match(String(renamed.message), /thêm tên miền mới/)
  assert.equal(
    (await designer('website_studio.getResource', { siteId: 'site-b', kind: 'domains', id: 'd-new' })).status,
    404,
  )
  // There is nothing to check, and checking changes nothing.
  assert.equal((await verify('d-new')).value.revisionId, second.revisionId)

  assert.equal((await switchTo('d-new', false, 'd-main')).status, 400, 'the switch is confirmed first')
  assert.equal((await switchTo('d-new', true, null)).status, 400, 'a primary changed meanwhile is a conflict')
  const switched = await switchTo('d-new', true, 'd-main')
  assert.equal(switched.status, 200, String(switched.message))
  assert.equal(switched.value.role, 'primary')
  assert.equal((await domain('d-main')).role, 'redirect')

  // Another name is another domain, also behind the Studio's back: anything kept about a host was
  // for the name it was added with.
  const moved = await designer.post('/_ket/fn/website.saveDomain', {
    id: 'd-new',
    siteId: 'site-a',
    host: 'cu.lanh.test',
    primary: true,
  })
  assert.match(JSON.stringify(moved), /website\.error\.immutableHost/)
  assert.equal((await domain('d-new')).host, 'moi.lanh.test')
})

/**
 * An operator serving many owners' sites decides how a host comes to be served. The Studio shows
 * what the policy says, hands it each host it adds and each check asked for, and makes a host the
 * address only once the policy has it proven and answering over HTTPS.
 */
test('Studio domains: an operator policy proves and serves the hosts', async (t) => {
  const proofs = new Map<string, { token: string; verified: boolean; serving: boolean; checks: number }>()
  const calls: string[] = []
  const policy: StudioDomainPolicy = {
    status: (d) => {
      const proof = proofs.get(String(d.id))
      return {
        state: proof?.verified ? 'verified' : proof?.checks ? 'failed' : 'pending',
        tls: proof?.serving ? 'ready' : 'pending',
        checkedAt: proof?.checks ? `2026-10-06T00:00:0${proof.checks}.000Z` : null,
        reason: proof?.checks ? (proof.verified ? 'matched' : 'missing') : null,
        challenge:
          proof && !proof.verified ? { type: 'TXT', name: `_proof.${d.host}`, value: proof.token } : null,
        route:
          proof?.token && !proof.serving
            ? {
                type: 'CNAME',
                name: String(d.host),
                value: 'sites.operator.test',
                apex: !String(d.host).includes('.', String(d.host).indexOf('.') + 1),
                check: proof.checks ? (proof.verified ? 'routed' : 'missing') : null,
              }
            : null,
        revision: proof ? `${proof.verified}:${proof.serving}:${proof.checks}` : '',
      }
    },
    siteCreated: async (call, site) => {
      calls.push(`site:${site.id}`)
      await call('website.saveDomain', {
        id: `${site.id}-address`,
        siteId: site.id,
        host: `${site.id}.operator.test`,
        primary: true,
      })
      proofs.set(`${site.id}-address`, { token: '', verified: true, serving: true, checks: 0 })
    },
    added: async (call, d) => {
      // The hook calls as the person adding the host: it can read what they can.
      assert.ok(Array.isArray(await call('website.listDomains', { siteId: d.siteId })))
      calls.push(`added:${d.host}`)
      proofs.set(String(d.id), { token: `token-${d.host}`, verified: false, serving: false, checks: 0 })
    },
    verify: async (_call, d) => {
      calls.push(`verify:${d.host}`)
      const proof = proofs.get(String(d.id))!
      proof.checks += 1
      if (proof.checks > 1) proof.verified = true
    },
  }
  const { app } = await bootWebsiteStudio(undefined, {
    deployment: 'commerce',
    studio: { domains: policy },
  })
  t.after(() => app.close())
  const designer = await studioClient(app, 'studio-designer')
  const reader = await studioClient(app, 'studio-reader')
  const { add, domain, verify, switchTo } = domainScreens(designer)

  const first = (await add('d-main', 'lanh.test')).value
  assert.deepEqual([first.role, first.state, first.tls], ['primary', 'pending', 'pending'])
  const second = (await add('d-new', 'moi.lanh.test')).value
  assert.deepEqual(second.challenge, {
    type: 'TXT',
    name: '_proof.moi.lanh.test',
    value: 'token-moi.lanh.test',
  })
  // Where to point the host, until it answers there.
  assert.deepEqual(second.route, {
    type: 'CNAME',
    name: 'moi.lanh.test',
    value: 'sites.operator.test',
    apex: false,
    check: null,
  })
  assert.equal((first.route as Row).apex, true)
  // A retried add is the same host: the policy is not handed it twice.
  await add('d-new', 'moi.lanh.test')
  assert.deepEqual(calls, ['added:lanh.test', 'added:moi.lanh.test'])

  assert.equal(
    (
      await reader('website_studio.verifyDomain', {
        siteId: 'site-a',
        id: 'd-new',
        expectedRevisionId: (await domain('d-new')).revisionId,
      })
    ).status,
    403,
    'checking a host is the site administrator’s',
  )
  const failed = (await verify('d-new')).value
  assert.deepEqual([failed.state, failed.reason], ['failed', 'missing'])
  assert.equal(
    (
      await designer('website_studio.verifyDomain', {
        siteId: 'site-a',
        id: 'd-new',
        expectedRevisionId: second.revisionId,
      })
    ).status,
    400,
    'a check acts on what the screen last saw',
  )
  const proven = (await verify('d-new')).value
  assert.deepEqual([proven.state, proven.tls, proven.challenge], ['verified', 'pending', null])
  assert.equal((proven.route as Row).check, 'routed')
  assert.deepEqual(
    (proven.attempts as Row[]).map((a) => [a.result, a.reason]),
    [['verified', 'matched']],
  )

  // Proven but not answering over HTTPS: every other host would redirect into nothing.
  const unserved = await switchTo('d-new', true, 'd-main')
  assert.equal(unserved.status, 400)
  assert.match(String(unserved.message), /HTTPS/)
  proofs.get('d-new')!.serving = true
  const switched = await switchTo('d-new', true, 'd-main')
  assert.equal(switched.status, 200, String(switched.message))
  assert.equal(switched.value.role, 'primary')
  assert.equal(switched.value.route, null, 'a host that answers needs no pointing')

  // A new site gets the operator's address first; a host typed with it waits behind that address.
  const made = await designer('website_studio.saveResource', {
    siteId: 'site-a',
    kind: 'sites',
    id: 'site-new',
    expectedRevisionId: null,
    values: { title: 'Mới', host: 'moi.test' },
  })
  assert.equal(made.status, 200, String(made.message))
  const roles = async () =>
    Object.fromEntries(
      (
        (await designer('website_studio.listResources', { siteId: 'site-new', kind: 'domains' })).value
          .rows as Row[]
      ).map((d) => [d.title, d.role]),
    )
  assert.deepEqual(await roles(), { 'site-new.operator.test': 'primary', 'moi.test': 'redirect' })
  // A retried create is the same site: the operator is not handed it twice.
  await designer('website_studio.saveResource', {
    siteId: 'site-a',
    kind: 'sites',
    id: 'site-new',
    expectedRevisionId: null,
    values: { title: 'Mới', host: 'moi.test' },
  })
  assert.equal(calls.filter((c) => c === 'site:site-new').length, 1)
})
