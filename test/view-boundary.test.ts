import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, createJoints, defineModule } from '@ketvietlab/ketjs'
import type { KetModule } from '@ketvietlab/ketjs'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'

/**
 * A view is the only data a theme receives. A theme could declare its own view
 * over `auth.User`, with no depends, and a fill then read `passwordHash`; and a
 * module listing the owner's unexposed field in its own view widened what the
 * owner's joint handed it.
 */
const auth = defineModule({
  name: 'auth',
  models: {
    User: {
      scope: 'shared',
      fields: { id: 'id', name: 'text', passwordHash: { type: 'text?', sensitive: true } },
    },
  },
})
const catalog = defineModule({
  name: 'catalog',
  models: { Product: { scope: 'shared', fields: { id: 'id', title: 'text', cost: 'decimal?' } } },
  views: { card: { of: 'catalog.Product', fields: ['id', 'title'] } },
  joints: { 'product.footer': { props: { product: 'catalog.card' } } },
})

const codes = (modules: KetModule[]): string[] => {
  try {
    compose(modules, { headless: true })
    return []
  } catch (error) {
    return ((error as { items?: Array<{ code: string }> }).items ?? []).map((item) => item.code)
  }
}

test('view boundary: no view exposes a sensitive field, whoever declares it', () => {
  const owner = defineModule({
    name: 'auth',
    models: auth.models,
    views: { login: { of: 'auth.User', fields: ['id', 'passwordHash'] } },
  })
  assert.deepEqual(codes([owner]), ['E_VIEW_SENSITIVE_FIELD'])
  const theme = defineModule({
    name: 'paper',
    kind: 'theme',
    depends: ['auth'],
    views: { me: { of: 'auth.User', fields: ['name', 'passwordHash'] } },
  })
  assert.deepEqual(codes([auth, theme]), ['E_VIEW_SENSITIVE_FIELD'])
})

test('view boundary: a module declares views only over models it depends on', () => {
  const theme = defineModule({
    name: 'paper',
    kind: 'theme',
    views: { me: { of: 'auth.User', fields: ['name'] } },
  })
  assert.deepEqual(codes([auth, theme]), ['E_VIEW_NOT_DEPENDED'])
})

test('view boundary: a reader widens a joint only with fields it contributed', () => {
  const inventory = defineModule({
    name: 'inventory',
    depends: ['catalog'],
    extend: { 'catalog.Product': { leadTimeDays: 'int?' } },
    views: { stock: { of: 'catalog.Product', fields: ['id', 'leadTimeDays', 'cost'] } },
    fills: { 'catalog:product.footer': '{{ product.title }}|{{ product.leadTimeDays }}|{{ product.cost }}' },
  })
  const joints = createJoints(compose([catalog, inventory], { headless: true }))
  const markup = joints.render('catalog:product.footer', {
    product: { id: 'p1', title: 'Chair', leadTimeDays: 3, cost: '12.50' },
  })
  assert.equal(
    renderToStaticString(html`${markup}`),
    'Chair|3|',
    'its own extension field crosses; the owner’s unexposed cost does not',
  )
})
