import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  compose,
  defineDeployment,
  defineFn,
  defineModule,
  defineTheme,
  text,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Placement } from '@ketvietlab/ketjs'

/**
 * A section whose presenter needs more than its settings - a form needs its fields - names a
 * function that answers for it. The framework asks that function once per placement before the
 * presenter runs, so the presenter stays a pure function of its scope; a public page is anyone's
 * to request, so the function must be anonymous and change nothing, and a layout cannot make one
 * request ask it more than twenty times.
 */

const memory = { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_COMPANY: 'acme' }
const place = (id: string, word: string, slots?: Record<string, Placement[]>): Placement => ({
  id,
  type: 'probe.block',
  settings: { word },
  ...(slots ? { slots } : {}),
})

const probe = (functions: Record<string, FnSpec>, layout: Placement[] = []) =>
  defineModule({
    name: 'probe',
    models: { Note: { scope: 'company', fields: { id: 'id', body: 'text' } } },
    sections: {
      'probe.block': {
        title: 'Probe',
        settings: { word: 'text' },
        slots: { inside: {} },
        resolve: 'probe.answer',
      },
      'probe.plain': { title: 'Plain', settings: {} },
    },
    functions: {
      page: defineFn({
        anonymous: true,
        input: { path: 'text', siteId: 'id?' },
        effects: [],
        handler: async (_ctx: Ctx, args) =>
          args.path === '/' ? { id: 'home', title: 'Home', siteId: 'site-1', layout } : null,
      }),
      ...functions,
    },
  })

const answer = defineFn({
  anonymous: true,
  input: { siteId: 'id?', settings: 'json?' },
  effects: [],
  handler: async (_ctx: Ctx, args) => ({
    word: String((args.settings as { word?: string }).word).toUpperCase(),
    siteId: args.siteId,
  }),
})

test('section resolve: the function must exist, answer anyone and change nothing', () => {
  assert.throws(() => compose([probe({})], { headless: true }), /E_SECTION_UNKNOWN_RESOLVER/)
  assert.throws(
    () => compose([probe({ answer: defineFn({ ...answer, anonymous: false }) })], { headless: true }),
    /E_SECTION_RESOLVER_UNSAFE/,
  )
  for (const effect of ['write:probe.Note', 'enqueue:probe.answer'])
    assert.throws(
      () => compose([probe({ answer: defineFn({ ...answer, effects: [effect] }) })], { headless: true }),
      /E_SECTION_RESOLVER_UNSAFE/,
    )
  const manifest = compose([probe({ answer: defineFn({ ...answer, effects: ['read:probe.Note'] }) })], {
    headless: true,
  })
  assert.equal(manifest.sections['probe.block']?.resolve, 'probe.answer')
})

test('section resolve: each placement, nested ones too, reaches the presenter by its id', async () => {
  let calls = 0
  const counted = defineFn({
    ...answer,
    handler: async (ctx: Ctx, args) => {
      calls += 1
      return (args.settings as { word?: string }).word === 'none' ? null : answer.handler(ctx, args)
    },
  })
  const layout = [
    place('first-block', 'một', { inside: [place('nested-block', 'hai')] }),
    { id: 'plain-block', type: 'probe.plain', settings: {} },
    place('empty-block', 'none'),
    ...Array.from({ length: 25 }, (_, i) => place(`many-${String(i).padStart(3, '0')}`, `w${i}`)),
  ]
  let seen: Record<string, unknown> = {}
  const app = defineDeployment({
    name: 'section_resolve',
    modules: [probe({ answer: counted }, layout)],
    // The presenter below answers every page; the theme is only what a storefront must name.
    theme: defineTheme({
      name: 'theme_probe',
      depends: ['probe'],
      templates: {
        layout: '<html><body>{% region "website.page" %}</body></html>',
        'website.page': '<main>{% sections %}</main>',
        'probe.block': '<p>{{ word }}</p>',
        'probe.plain': '<hr>',
      },
    }),
    serve: {
      pages: {
        resolve: 'probe.page',
        render: (scope) => {
          seen = scope.sectionData as Record<string, unknown>
          return text('ok')
        },
      },
    },
  })
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const response = await fetch(`http://127.0.0.1:${booted.port}/`)
    assert.equal(response.status, 200)
    assert.equal(seen['first-block'] && (seen['first-block'] as { word: string }).word, 'MỘT')
    assert.deepEqual(seen['nested-block'], { word: 'HAI', siteId: 'site-1' })
    assert.equal(seen['empty-block'], null)
    assert.equal('plain-block' in seen, false)
    // Twenty and no more, however many the layout holds.
    assert.equal(calls, 20)
    assert.equal(Object.keys(seen).length, 20)
    assert.equal('many-016' in seen, true)
    assert.equal('many-017' in seen, false)
  } finally {
    await booted.close()
  }
})
