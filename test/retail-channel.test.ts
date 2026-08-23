import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { createTestApp, type TestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }
const REALM = 'site:default:retail'

type Envelope<T> = {
  data: T
  error: { code: string; message: string; fieldErrors: Record<string, { messageKey: string }> } | null
  meta: { requestId: string; nextCursor: string | null }
}

const boot = async (t: TestContext) => {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const seed = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

  await seed('partner.savePartner', { id: 'company-partner', kind: 'company', name: 'Ket Retail' })
  await seed('company.saveCompany', { id: 'default', partnerId: 'company-partner', currency: 'VND' })
  await seed('uom.saveUnit', { id: 'unit', name: 'Cái', relativeFactor: '1', sequence: 10, active: true })
  await seed('stock.saveWarehouse', { id: 'main', name: 'Kho chính', code: 'WH' })
  await seed('website.saveSite', {
    id: 'retail',
    name: 'Retail',
    title: 'Kết Goods',
    defaultLocale: 'vi',
    theme: 'theme_retail',
  })
  await seed('product.saveTemplate', {
    id: 'canvas-bag',
    name: 'Túi canvas',
    type: 'goods',
    uomId: 'unit',
    listPrice: '250000',
    saleOk: true,
    purchaseOk: true,
  })
  await seed('product.saveVariant', {
    id: 'canvas-bag-natural',
    templateId: 'canvas-bag',
    defaultCode: 'BAG-NATURAL',
  })
  await seed('product.saveTemplate', {
    id: 'enamel-mug',
    name: 'Ly men',
    type: 'goods',
    uomId: 'unit',
    listPrice: '120000',
    saleOk: true,
    purchaseOk: true,
  })
  await seed('product.saveVariant', { id: 'enamel-mug-white', templateId: 'enamel-mug', defaultCode: 'MUG' })
  for (const [id, productId, position] of [
    ['retail:bag', 'canvas-bag-natural', 10],
    ['retail:mug', 'enamel-mug-white', 20],
  ] as const)
    await seed('website_retail.saveCatalogItem', {
      id,
      siteId: 'retail',
      productId,
      active: true,
      position,
    })
  return { e2e, seed }
}

const configure = (seed: (name: string, input: Record<string, unknown>) => Promise<unknown>) =>
  seed('website_retail.saveStoreSettings', {
    id: 'retail:store',
    siteId: 'retail',
    warehouseId: 'main',
    defaultUomId: 'unit',
    orderPolicy: 'quotation',
  })

const channel = async <T>(
  e2e: TestApp,
  path: string,
  init: RequestInit & { token?: string; cart?: string; key?: string } = {},
): Promise<{ status: number; body: Envelope<T> }> => {
  const headers: Record<string, string> = { 'x-channel-realm': REALM }
  if (init.body) headers['content-type'] = 'application/json'
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.cart) headers['x-cart-token'] = init.cart
  if (init.key) headers['idempotency-key'] = init.key
  const response = await e2e.client.request(`/api/customer/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  })
  return { status: response.status, body: (await response.json()) as Envelope<T> }
}

const signIn = async (e2e: TestApp, email: string): Promise<string> => {
  const registered = await channel<{ accessToken: string }>(e2e, 'auth/token/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Lan Anh', email, password: 'retail-password-1' }),
  })
  assert.equal(registered.status, 201)
  return registered.body.data.accessToken
}

test('retail channel: a guest cart survives sign-in and becomes a sales order', async (t) => {
  const { e2e, seed } = await boot(t)
  await configure(seed)

  const storefront = await channel<{ ordering: boolean; currency: string; orderPolicy: string }>(
    e2e,
    'retail/storefront',
  )
  assert.equal(storefront.status, 200)
  assert.deepEqual(
    {
      ordering: storefront.body.data.ordering,
      currency: storefront.body.data.currency,
      policy: storefront.body.data.orderPolicy,
    },
    { ordering: true, currency: 'VND', policy: 'quotation' },
  )

  const products = await channel<Array<{ id: string; name: string; price: string }>>(
    e2e,
    'retail/products?limit=1',
  )
  assert.equal(products.status, 200)
  assert.deepEqual(
    products.body.data.map((item) => item.id),
    ['canvas-bag-natural'],
  )
  assert.equal(products.body.data[0]?.price, '250000')
  assert.ok(products.body.meta.nextCursor)
  const second = await channel<Array<{ id: string }>>(
    e2e,
    `retail/products?limit=1&cursor=${products.body.meta.nextCursor}`,
  )
  assert.deepEqual(
    second.body.data.map((item) => item.id),
    ['enamel-mug-white'],
  )

  // The shopper is not signed in yet, so the cart is held by its token alone.
  const started = await channel<{ cartToken: string; cart: { claimed: boolean } }>(e2e, 'retail/carts', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert.equal(started.status, 201)
  const guestToken = started.body.data.cartToken
  assert.equal(started.body.data.cart.claimed, false)

  const filled = await channel<{ total: string; lines: Array<{ productId: string; quantity: string }> }>(
    e2e,
    'retail/cart/lines',
    {
      method: 'PUT',
      cart: guestToken,
      body: JSON.stringify({ productId: 'canvas-bag-natural', quantity: '2' }),
    },
  )
  assert.equal(filled.status, 200)
  assert.equal(filled.body.data.total, '500000')

  const token = await signIn(e2e, 'lan.anh@example.test')

  // Signing in on the same device keeps the cart the shopper already filled.
  const claimed = await channel<{ merged: boolean; cart: { id: string; claimed: boolean; total: string } }>(
    e2e,
    'retail/cart/claim',
    { method: 'POST', token, cart: guestToken },
  )
  assert.equal(claimed.status, 200)
  assert.deepEqual(
    { merged: claimed.body.data.merged, claimed: claimed.body.data.cart.claimed },
    { merged: false, claimed: true },
  )

  const grown = await channel<{ total: string }>(e2e, 'retail/cart/lines', {
    method: 'PUT',
    token,
    cart: guestToken,
    body: JSON.stringify({ productId: 'enamel-mug-white', quantity: '3' }),
  })
  assert.equal(grown.body.data.total, '860000')

  const ordered = await channel<{ id: string; name: string; state: string; amountTotal: string }>(
    e2e,
    'retail/checkout',
    {
      method: 'POST',
      token,
      cart: guestToken,
      key: 'retail-order-1',
      body: JSON.stringify({ customerName: 'Lan Anh', note: 'Giao giờ hành chính' }),
    },
  )
  assert.equal(ordered.status, 201)
  assert.equal(ordered.body.data.state, 'draft')
  assert.equal(ordered.body.data.amountTotal, '860000')
  assert.match(ordered.body.data.name, /^S\d{5}$/)

  // The same key answers with the same order rather than opening a second one.
  const replay = await channel<{ id: string }>(e2e, 'retail/checkout', {
    method: 'POST',
    token,
    cart: guestToken,
    key: 'retail-order-1',
    body: JSON.stringify({ customerName: 'Lan Anh', note: 'Giao giờ hành chính' }),
  })
  assert.equal(replay.body.data.id, ordered.body.data.id)

  const detail = await channel<{ lines: Array<{ productId: string; subtotal: string }> }>(
    e2e,
    `retail/orders/${ordered.body.data.id}`,
    { token },
  )
  assert.equal(detail.status, 200)
  assert.deepEqual(
    detail.body.data.lines.map((line) => [line.productId, line.subtotal]).sort(),
    [
      ['canvas-bag-natural', '500000'],
      ['enamel-mug-white', '360000'],
    ].sort(),
  )

  const mine = await channel<Array<{ id: string }>>(e2e, 'retail/orders', { token })
  assert.deepEqual(
    mine.body.data.map((order) => order.id),
    [ordered.body.data.id],
  )

  // The order is a first-class sales order, not a parallel record beside one.
  const stored = (await e2e.fixture.call<Row>('sale.getOrder', { id: ordered.body.data.id }, { scope })).value
  // sale.getOrder answers with the stored row, where the adapter's decimal is a number.
  assert.equal(String(stored.amountTotal), '860000')
  assert.equal(stored.state, 'draft')
  assert.equal(stored.warehouseId, 'main')
  assert.equal(stored.clientOrderRef, claimed.body.data.cart.id)
  assert.equal((stored.lines as Row[]).length, 2)
})

test('retail channel: claiming folds the cart the shopper already had into the one in hand', async (t) => {
  const { e2e, seed } = await boot(t)
  await configure(seed)
  const token = await signIn(e2e, 'two.devices@example.test')

  // Device one: signed in, so the cart is the account's from the start.
  const first = await channel<{ cartToken: string; cart: { id: string } }>(e2e, 'retail/carts', {
    method: 'POST',
    token,
    body: JSON.stringify({}),
  })
  await channel(e2e, 'retail/cart/lines', {
    method: 'PUT',
    token,
    cart: first.body.data.cartToken,
    body: JSON.stringify({ productId: 'enamel-mug-white', quantity: '1' }),
  })

  // Device two: browsing as a guest, with a cart nobody owns yet.
  const guest = await channel<{ cartToken: string }>(e2e, 'retail/carts', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  await channel(e2e, 'retail/cart/lines', {
    method: 'PUT',
    cart: guest.body.data.cartToken,
    body: JSON.stringify({ productId: 'canvas-bag-natural', quantity: '2' }),
  })

  const claimed = await channel<{
    merged: boolean
    cart: { id: string; total: string; lines: Array<{ productId: string; quantity: string }> }
  }>(e2e, 'retail/cart/claim', { method: 'POST', token, cart: guest.body.data.cartToken })
  assert.equal(claimed.status, 200)
  assert.equal(claimed.body.data.merged, true)
  assert.deepEqual(
    claimed.body.data.cart.lines.map((line) => [line.productId, line.quantity]).sort(),
    [
      ['canvas-bag-natural', '2'],
      ['enamel-mug-white', '1'],
    ].sort(),
  )
  assert.equal(claimed.body.data.cart.total, '620000')

  // The cart that was folded in is spent, and the surviving one is no longer
  // reachable by its token alone.
  const absorbed = await channel(e2e, 'retail/cart', { token, cart: first.body.data.cartToken })
  assert.equal(absorbed.status, 404)
  const anonymous = await channel(e2e, 'retail/cart', { cart: guest.body.data.cartToken })
  assert.equal(anonymous.status, 404)
  assert.equal(anonymous.body.error?.code, 'website_retail.cartUnavailable')

  const mine = await channel<{ id: string }>(e2e, 'retail/cart', { token })
  assert.equal(mine.body.data.id, claimed.body.data.cart.id)
})

test('retail channel: another shopper cannot read an order by guessing its id', async (t) => {
  const { e2e, seed } = await boot(t)
  await configure(seed)
  const owner = await signIn(e2e, 'owner@example.test')
  const started = await channel<{ cartToken: string }>(e2e, 'retail/carts', {
    method: 'POST',
    token: owner,
    body: JSON.stringify({}),
  })
  const cart = started.body.data.cartToken
  await channel(e2e, 'retail/cart/lines', {
    method: 'PUT',
    token: owner,
    cart,
    body: JSON.stringify({ productId: 'canvas-bag-natural', quantity: '1' }),
  })
  const ordered = await channel<{ id: string }>(e2e, 'retail/checkout', {
    method: 'POST',
    token: owner,
    cart,
    key: 'owner-order',
    body: JSON.stringify({}),
  })
  assert.equal(ordered.status, 201)

  const stranger = await signIn(e2e, 'stranger@example.test')
  const denied = await channel(e2e, `retail/orders/${ordered.body.data.id}`, { token: stranger })
  assert.equal(denied.status, 404)
  assert.equal(denied.body.error?.code, 'website_retail.orderNotFound')
  const empty = await channel<unknown[]>(e2e, 'retail/orders', { token: stranger })
  assert.deepEqual(empty.body.data, [])
})

test('retail channel: an unconfigured store browses and fills a cart but refuses to order', async (t) => {
  const { e2e } = await boot(t)
  const storefront = await channel<{ ordering: boolean }>(e2e, 'retail/storefront')
  assert.equal(storefront.body.data.ordering, false)

  const token = await signIn(e2e, 'early@example.test')
  const started = await channel<{ cartToken: string }>(e2e, 'retail/carts', {
    method: 'POST',
    token,
    body: JSON.stringify({}),
  })
  const cart = started.body.data.cartToken
  const filled = await channel<{ total: string }>(e2e, 'retail/cart/lines', {
    method: 'PUT',
    token,
    cart,
    body: JSON.stringify({ productId: 'canvas-bag-natural', quantity: '1' }),
  })
  assert.equal(filled.body.data.total, '250000')

  const refused = await channel(e2e, 'retail/checkout', {
    method: 'POST',
    token,
    cart,
    key: 'unconfigured-1',
    body: JSON.stringify({}),
  })
  assert.equal(refused.status, 409)
  assert.equal(refused.body.error?.code, 'website_retail.orderingUnavailable')
  assert.equal(refused.body.error?.message, 'Website chưa được cấu hình để nhận đơn hàng.')
})

test('retail channel: the facade guards the cart routes before the domain sees them', async (t) => {
  const { e2e, seed } = await boot(t)
  await configure(seed)

  // auth: 'customer' routes are settled by the facade.
  assert.equal((await channel(e2e, 'retail/cart/claim', { method: 'POST' })).status, 401)
  assert.equal((await channel(e2e, 'retail/orders', { method: 'GET' })).status, 401)

  const token = await signIn(e2e, 'guarded@example.test')
  const noToken = await channel(e2e, 'retail/cart/claim', { method: 'POST', token })
  assert.equal(noToken.status, 400)
  assert.equal(noToken.body.error?.code, 'website_retail.cartTokenRequired')

  const started = await channel<{ cartToken: string }>(e2e, 'retail/carts', {
    method: 'POST',
    token,
    body: JSON.stringify({}),
  })
  // The published body schema is enforced, so an off-contract field never reaches the cart.
  const offContract = await channel(e2e, 'retail/cart/lines', {
    method: 'PUT',
    token,
    cart: started.body.data.cartToken,
    body: JSON.stringify({ productId: 'canvas-bag-natural', unitPrice: '1' }),
  })
  assert.equal(offContract.status, 422)
  assert.equal(offContract.body.error?.code, 'channel_api.invalidRequest')
  assert.deepEqual(Object.keys(offContract.body.error?.fieldErrors ?? {}).sort(), ['quantity', 'unitPrice'])

  const missingKey = await channel(e2e, 'retail/checkout', {
    method: 'POST',
    token,
    cart: started.body.data.cartToken,
    body: JSON.stringify({}),
  })
  assert.equal(missingKey.status, 400)
  assert.equal(missingKey.body.error?.code, 'channel_api.idempotencyRequired')
})

test('retail channel: a shopper cannot place orders faster than the store allows', async (t) => {
  const { e2e, seed } = await boot(t)
  await configure(seed)
  const token = await signIn(e2e, 'eager@example.test')

  // Twenty an hour is the declared ceiling. The twenty-first is refused whether
  // or not it would otherwise have succeeded.
  const attempt = async (n: number) => {
    const started = await channel<{ cartToken: string }>(e2e, 'retail/carts', {
      method: 'POST',
      token,
      body: JSON.stringify({}),
    })
    const cart = started.body.data.cartToken
    await channel(e2e, 'retail/cart/lines', {
      method: 'PUT',
      token,
      cart,
      body: JSON.stringify({ productId: 'canvas-bag-natural', quantity: '1' }),
    })
    return channel(e2e, 'retail/checkout', {
      method: 'POST',
      token,
      cart,
      key: `order-${n}`,
      body: JSON.stringify({}),
    })
  }

  for (let n = 0; n < 20; n += 1) assert.equal((await attempt(n)).status, 201, `order ${n}`)

  const refused = await attempt(20)
  assert.equal(refused.status, 429)
  assert.equal(refused.body.error?.code, 'channel_api.rateLimited')
  assert.equal(refused.body.error?.message, 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.')
})
