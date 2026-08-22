// The retail storefront's own entry points.
//
// Everything a shopper can reach lives here rather than in functions.ts, because
// the audience is different in the way that matters: these are called by the
// Channel API on behalf of someone who is not a member of the company, so each
// one carries its own site scoping and none of them is reachable through the
// generic function transport.
//
// Checkout composes Sale's commands in one transaction rather than restating
// them. A price is never accepted from the caller — it is read from the
// pricelist the store settings name, by the same code a salesperson's quotation
// goes through.

import { randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { functions as saleFunctions } from '../sale/functions.ts'
import { canManageStructure } from '../website/access.ts'
import { cartOf, cartTotal, decimal, digest, page, retailSite } from './functions.ts'

const MAX_CART_LINES = 100
const MAX_LINE_QUANTITY = 10_000n
const CART_DAYS = 7
const ORDER_POLICIES = ['quotation', 'confirm'] as const

type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }

const problem = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `website_retail.error.${code}`,
  ...(params ? { params } : {}),
})
const failure = (...errors: Issue[]) => ({ ok: false as const, errors })

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

/** Sale answers with plain prose; the channel needs a code it can translate. */
const rejected = (field: string, result: unknown): { ok: false; errors: Issue[] } => {
  const first = (result as { errors?: Array<{ field?: string; message?: string }> })?.errors?.[0]
  return failure(
    problem(first?.field ?? field, 'orderRejected', {
      ...(first?.message ? { detail: first.message } : {}),
    }),
  )
}

const settingsFor = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const row = (await ctx.db.select('website_retail.StoreSettings', { siteId, active: true }))[0]
  return row ?? null
}

const sellable = async (ctx: Ctx, siteId: unknown, productId: unknown) => {
  const item = (await ctx.db.select('website_retail.CatalogItem', { siteId, productId, active: true }))[0]
  if (!item) return null
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (product?.active !== true) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (template?.active !== true || template.saleOk !== true) return null
  return { item, product, template }
}

/**
 * One price, resolved the way the order will resolve it.
 *
 * A storefront that advertises the list price and then bills the pricelist price
 * is a support ticket, so the catalogue asks the same function checkout does.
 */
const priceOf = async (
  ctx: Ctx,
  settings: Row | null,
  product: Row,
  template: Row,
  quantity = '1',
): Promise<string> => {
  if (!settings?.pricelistId) return String(template.listPrice)
  const priced = (await pricingFunctions.priceFor!.handler(ctx, {
    pricelistId: settings.pricelistId,
    productId: product.id,
    quantity,
    uomId: template.uomId ?? settings.defaultUomId,
  })) as Row
  return priced?.ok === true ? String(priced.price) : String(template.listPrice)
}

/**
 * Money and quantities leave as strings.
 *
 * A JSON number cannot hold every decimal the ledger can, and a storefront that
 * rounds a total in transit is worse than one that never showed it.
 */
const amount = (value: unknown): string => String(value ?? '0')

const productView = (product: Row, template: Row, price: string, imageId: unknown) => ({
  id: String(product.id),
  templateId: String(template.id),
  name: template.name,
  description: template.description ?? null,
  defaultCode: product.defaultCode ?? null,
  type: template.type,
  price: amount(price),
  listPrice: amount(template.listPrice),
  primaryImage: imageId ? { url: `/files/${encodeURIComponent(String(imageId))}` } : null,
})

const imagesFor = async (ctx: Ctx, products: Row[]): Promise<Map<string, unknown>> => {
  if (!products.length) return new Map()
  const Media = ctx.table('product_media.Media')
  const rows = await ctx.db.all(
    from(Media).where(eq(Media.primary, true)).orderBy(asc(Media.sequence), asc(Media.id)),
  )
  const byProduct = new Map<string, unknown>()
  const templates = new Map<string, unknown>()
  for (const row of rows) {
    if (row.productId != null && !byProduct.has(String(row.productId)))
      byProduct.set(String(row.productId), row.attachmentId)
    if (row.templateId != null && !templates.has(String(row.templateId)))
      templates.set(String(row.templateId), row.attachmentId)
  }
  return new Map(
    products.map((product) => [
      String(product.id),
      byProduct.get(String(product.id)) ?? templates.get(String(product.templateId)) ?? null,
    ]),
  )
}

const cartView = (cart: Row, lines: Row[]) => ({
  id: String(cart.id),
  siteId: String(cart.siteId),
  status: cart.status,
  currency: cart.currency,
  claimed: cart.accountId != null,
  orderId: cart.orderId ?? null,
  orderName: cart.orderName ?? null,
  expiresAt: cart.expiresAt,
  lines: lines.map((line) => ({
    id: String(line.id),
    productId: String(line.productId),
    name: line.name,
    quantity: amount(line.quantity),
    unitPrice: amount(line.unitPrice),
  })),
  total: amount(cartTotal(lines)),
})

const linesOf = (ctx: Ctx, cartId: unknown): Promise<Row[]> =>
  ctx.db.select('website_retail.CartLine', { cartId })

const openCartForAccount = async (ctx: Ctx, siteId: unknown, accountId: unknown): Promise<Row | null> => {
  const Cart = ctx.table('website_retail.Cart')
  const rows = await ctx.db.all(
    from(Cart)
      .where(eq(Cart.siteId, siteId), eq(Cart.accountId, accountId), eq(Cart.status, 'open'))
      .orderBy(asc(Cart.updatedAt)),
  )
  const live = rows.filter((row) => new Date(String(row.expiresAt)) > new Date())
  return live.at(-1) ?? null
}

const issueToken = async (ctx: Ctx, cartId: unknown): Promise<string> => {
  const token = randomBytes(24).toString('base64url')
  await ctx.db.update(
    'website_retail.Cart',
    { id: cartId },
    {
      tokenDigest: digest(token),
      expiresAt: new Date(Date.now() + CART_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    },
  )
  return token
}

const quantityText = (units: bigint, scale: number): string => {
  if (!scale) return String(units)
  const padded = String(units).padStart(scale + 1, '0')
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, '') || '0'
}

const cartEffects = [
  'read:website_retail.Cart',
  'write:website_retail.Cart',
  'read:website_retail.CartLine',
  'write:website_retail.CartLine',
]
const catalogEffects = [
  'read:website.Site',
  'read:website_retail.StoreSettings',
  'read:website_retail.CatalogItem',
  'read:product.Product',
  'read:product.Template',
]

export const online: Record<string, FnSpec> = {
  saveStoreSettings: defineFn({
    input: {
      id: 'id',
      siteId: 'id',
      warehouseId: 'id',
      defaultUomId: 'id',
      pricelistId: 'id?',
      orderPolicy: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_retail.StoreSettings',
      'write:website_retail.StoreSettings',
      'read:stock.Warehouse',
      'read:pricing.Pricelist',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return failure(problem('siteId', 'invalidSite'))
      if (!(await canManageStructure(ctx, args.siteId)))
        return { ok: false, errors: [{ field: 'siteId', message: 'website.error.forbidden' }] }
      const policy = String(args.orderPolicy ?? 'quotation')
      if (!ORDER_POLICIES.includes(policy as (typeof ORDER_POLICIES)[number]))
        return failure(problem('orderPolicy', 'invalidOrderPolicy'))
      if (!(await ctx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
        return failure(problem('warehouseId', 'warehouseUnavailable'))
      if (!(await ctx.db.select('uom.Unit', { id: args.defaultUomId }))[0])
        return failure(problem('defaultUomId', 'uomUnavailable'))
      if (args.pricelistId && !(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
        return failure(problem('pricelistId', 'pricelistUnavailable'))
      const existing = (await ctx.db.select('website_retail.StoreSettings', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return { ok: false, errors: [{ field: 'id', message: 'website.error.immutableOwnership' }] }
      const row = {
        id: args.id,
        siteId: args.siteId,
        warehouseId: args.warehouseId,
        pricelistId: args.pricelistId ?? null,
        defaultUomId: args.defaultUomId,
        orderPolicy: policy,
        active: args.active !== false,
      }
      if (existing) await ctx.db.update('website_retail.StoreSettings', { id: args.id }, row)
      else await ctx.db.insert('website_retail.StoreSettings', row)
      return { ok: true, id: args.id }
    },
  }),

  channelStorefront: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id' },
    output: { ok: 'bool', storefront: 'json?', errors: 'json?' },
    effects: ['read:website.Site', 'read:website_retail.StoreSettings', 'read:company.Company'],
    handler: async (ctx: Ctx, args) => {
      const site = await retailSite(ctx, args.siteId)
      if (!site) return failure(problem('siteId', 'invalidSite'))
      const settings = await settingsFor(ctx, args.siteId)
      const company = ctx.scope.company
        ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
        : null
      return {
        ok: true,
        storefront: {
          siteId: String(site.id),
          name: site.title ?? site.name,
          currency: company?.currency ?? null,
          // False means the catalogue and cart still work and checkout does not:
          // nobody has told this site which warehouse ships an order.
          ordering: settings !== null,
          orderPolicy: settings?.orderPolicy ?? null,
        },
      }
    },
  }),

  listChannelProducts: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: { items: 'json', hasMore: 'bool' },
    effects: [
      ...catalogEffects,
      'read:product_media.Media',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
    ],
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return { items: [], hasMore: false }
      const paging = page(args.limit, args.offset)
      const Catalog = ctx.table('website_retail.CatalogItem')
      // One row past the page, so "is there a next cursor" needs no second count.
      const items = await ctx.db.all(
        from(Catalog)
          .where(eq(Catalog.siteId, args.siteId), eq(Catalog.active, true))
          .orderBy(asc(Catalog.position), asc(Catalog.id))
          .limit(paging.limit + 1)
          .offset(paging.offset),
      )
      const window = items.slice(0, paging.limit)
      if (!window.length) return { items: [], hasMore: false }
      const Product = ctx.table('product.Product')
      const products = await ctx.db.all(
        from(Product).where(
          inArray(
            Product.id,
            window.map((item) => item.productId),
          ),
          eq(Product.active, true),
        ),
      )
      const Template = ctx.table('product.Template')
      const templates = products.length
        ? await ctx.db.all(
            from(Template).where(
              inArray(
                Template.id,
                products.map((product) => product.templateId),
              ),
              eq(Template.active, true),
              eq(Template.saleOk, true),
            ),
          )
        : []
      const productById = new Map(products.map((product) => [String(product.id), product]))
      const templateById = new Map(templates.map((template) => [String(template.id), template]))
      const settings = await settingsFor(ctx, args.siteId)
      const images = await imagesFor(ctx, products)
      const views = []
      for (const item of window) {
        const product = productById.get(String(item.productId))
        const template = product ? templateById.get(String(product.templateId)) : null
        if (!product || !template) continue
        views.push(
          productView(
            product,
            template,
            await priceOf(ctx, settings, product, template),
            images.get(String(product.id)),
          ),
        )
      }
      return { items: views, hasMore: items.length > paging.limit }
    },
  }),

  getChannelProduct: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', productId: 'id' },
    output: { ok: 'bool', product: 'json?', errors: 'json?' },
    effects: [
      ...catalogEffects,
      'read:product_media.Media',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
    ],
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return failure(problem('siteId', 'invalidSite'))
      const held = await sellable(ctx, args.siteId, args.productId)
      if (!held) return failure(problem('productId', 'productUnavailable'))
      const settings = await settingsFor(ctx, args.siteId)
      const images = await imagesFor(ctx, [held.product])
      return {
        ok: true,
        product: productView(
          held.product,
          held.template,
          await priceOf(ctx, settings, held.product, held.template),
          images.get(String(held.product.id)),
        ),
      }
    },
  }),

  /**
   * Hand back a cart the caller can keep using.
   *
   * A shopper who signs in on a second device has an open cart and no token for
   * it, so proving the account is enough to be issued a fresh one. Rotating the
   * token rather than storing it keeps the digest-only rule intact.
   */
  startChannelCart: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', accountId: 'id?', currency: 'text?' },
    output: { ok: 'bool', cart: 'json?', token: 'text?', errors: 'json?' },
    effects: [...cartEffects, 'read:website.Site', 'read:website.CustomerAccount', 'read:company.Company'],
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return failure(problem('siteId', 'invalidSite'))
      if (args.accountId) {
        const existing = await openCartForAccount(ctx, args.siteId, args.accountId)
        if (existing) {
          const token = await issueToken(ctx, existing.id)
          const refreshed = (await ctx.db.select('website_retail.Cart', { id: existing.id }))[0]!
          return { ok: true, token, cart: cartView(refreshed, await linesOf(ctx, existing.id)) }
        }
      }
      const company = ctx.scope.company
        ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
        : null
      const currency = String(args.currency ?? company?.currency ?? 'VND')
        .trim()
        .toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) return failure(problem('currency', 'invalidCurrency'))
      const id = randomUUID()
      const token = randomBytes(24).toString('base64url')
      const row = {
        id,
        siteId: args.siteId,
        tokenDigest: digest(token),
        status: 'open',
        currency,
        accountId: args.accountId ?? null,
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        note: null,
        orderId: null,
        orderName: null,
        submittedAt: null,
        expiresAt: new Date(Date.now() + CART_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      }
      await ctx.db.insert('website_retail.Cart', row)
      return { ok: true, token, cart: cartView(row as unknown as Row, []) }
    },
  }),

  resolveChannelCart: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', token: 'text?', accountId: 'id?' },
    output: { ok: 'bool', cart: 'json?', errors: 'json?' },
    effects: ['read:website_retail.Cart', 'read:website_retail.CartLine'],
    handler: async (ctx: Ctx, args) => {
      const cart = args.token
        ? await cartOf(ctx, args.token)
        : args.accountId
          ? await openCartForAccount(ctx, args.siteId, args.accountId)
          : null
      // A merged cart's contents now live in another cart, so its old token has
      // nothing left to say; an ordered one is still worth reading as the receipt.
      if (!cart || cart.siteId !== args.siteId || cart.status === 'merged')
        return failure(problem('cart', 'cartUnavailable'))
      // A claimed cart belongs to one account and a bare token no longer opens it.
      if (cart.accountId != null && cart.accountId !== args.accountId)
        return failure(problem('cart', 'cartUnavailable'))
      return { ok: true, cart: cartView(cart, await linesOf(ctx, cart.id)) }
    },
  }),

  /**
   * Attach the cart in hand to the account that just signed in.
   *
   * The token the shopper holds keeps working and anything already in the
   * account's other open cart is folded into it, because the alternative — two
   * carts, one silently discarded — loses items the shopper chose.
   */
  claimChannelCart: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', token: 'text', accountId: 'id' },
    output: { ok: 'bool', cart: 'json?', merged: 'bool?', errors: 'json?' },
    effects: [...cartEffects, 'read:website.CustomerAccount'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (!cart || cart.siteId !== args.siteId || cart.status !== 'open')
        return failure(problem('cart', 'cartUnavailable'))
      if (cart.accountId != null && cart.accountId !== args.accountId)
        return failure(problem('cart', 'cartUnavailable'))
      const other = await openCartForAccount(ctx, args.siteId, args.accountId)
      const merging = other && other.id !== cart.id ? other : null
      return await ctx.tx(async (tx) => {
        if (merging) {
          const target = await linesOf(tx, cart.id)
          const byProduct = new Map(target.map((line) => [String(line.productId), line]))
          for (const line of await linesOf(tx, merging.id)) {
            const held = byProduct.get(String(line.productId))
            if (!held) {
              if (byProduct.size >= MAX_CART_LINES) continue
              await tx.db.insert('website_retail.CartLine', {
                id: randomUUID(),
                cartId: cart.id,
                productId: line.productId,
                name: line.name,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              })
              byProduct.set(String(line.productId), line)
              continue
            }
            const a = decimal(held.quantity, 3)
            const b = decimal(line.quantity, 3)
            if (!a || !b) continue
            const scale = Math.max(a.scale, b.scale)
            const units = a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale)
            const capped = units > MAX_LINE_QUANTITY * 10n ** BigInt(scale) ? a.units : units
            await tx.db.update(
              'website_retail.CartLine',
              { id: held.id },
              { quantity: quantityText(capped, capped === a.units ? a.scale : scale) },
            )
          }
          await tx.db.update('website_retail.Cart', { id: merging.id }, { status: 'merged' })
        }
        await tx.db.update('website_retail.Cart', { id: cart.id }, { accountId: args.accountId })
        const refreshed = (await tx.db.select('website_retail.Cart', { id: cart.id }))[0]!
        return {
          ok: true,
          merged: merging !== null,
          cart: cartView(refreshed, await linesOf(tx, cart.id)),
        }
      })
    },
  }),

  /**
   * Set a line to an absolute quantity; zero removes it.
   *
   * Absolute rather than additive because a retry of "add one" adds two, and a
   * storefront retries. The price is re-read here so a cart shown to the shopper
   * is the cart that will be ordered.
   */
  setChannelCartLine: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { siteId: 'id', token: 'text', accountId: 'id?', productId: 'id', quantity: 'decimal' },
    output: { ok: 'bool', cart: 'json?', errors: 'json?' },
    effects: [
      ...cartEffects,
      ...catalogEffects,
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
    ],
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (!cart || cart.siteId !== args.siteId || cart.status !== 'open')
        return failure(problem('cart', 'cartUnavailable'))
      if (cart.accountId != null && cart.accountId !== args.accountId)
        return failure(problem('cart', 'cartUnavailable'))
      const quantity = decimal(args.quantity, 3)
      if (!quantity || quantity.units > MAX_LINE_QUANTITY * 10n ** BigInt(quantity.scale))
        return failure(problem('quantity', 'invalidQuantity'))
      const Line = ctx.table('website_retail.CartLine')
      const existing = await ctx.db.one(
        from(Line).where(eq(Line.cartId, cart.id), eq(Line.productId, args.productId)),
      )
      if (quantity.units === 0n) {
        if (existing) await ctx.db.del(deleteFrom(Line).where(eq(Line.id, existing.id)))
        return { ok: true, cart: cartView(cart, await linesOf(ctx, cart.id)) }
      }
      const held = await sellable(ctx, args.siteId, args.productId)
      if (!held) return failure(problem('productId', 'productUnavailable'))
      const unitPrice = await priceOf(
        ctx,
        await settingsFor(ctx, args.siteId),
        held.product,
        held.template,
        String(args.quantity),
      )
      if (existing)
        await ctx.db.update(
          'website_retail.CartLine',
          { id: existing.id },
          { quantity: String(args.quantity), unitPrice },
        )
      else {
        if ((await linesOf(ctx, cart.id)).length >= MAX_CART_LINES)
          return failure(problem('productId', 'cartFull'))
        await ctx.db.insert('website_retail.CartLine', {
          id: randomUUID(),
          cartId: cart.id,
          productId: args.productId,
          name: held.template.name,
          quantity: String(args.quantity),
          unitPrice,
        })
      }
      return { ok: true, cart: cartView(cart, await linesOf(ctx, cart.id)) }
    },
  }),

  /**
   * Turn the cart into a sales order through Sale's own commands.
   *
   * Nothing about the order is computed here: the number, the prices, the taxes
   * and the totals all come from the functions a salesperson's quotation goes
   * through, so an online order and a desk order cannot drift apart. The whole
   * thing is one transaction, and a cart that already produced an order replays
   * that order instead of producing a second one.
   */
  submitChannelCart: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: {
      orderId: 'id',
      siteId: 'id',
      token: 'text',
      accountId: 'id',
      partnerId: 'id',
      customerName: 'text?',
      customerPhone: 'text?',
      note: 'text?',
    },
    output: { ok: 'bool', order: 'json?', errors: 'json?' },
    effects: [
      ...cartEffects,
      ...catalogEffects,
      ...effectsOf(saleFunctions.createOrder, saleFunctions.addLine, saleFunctions.confirmOrder),
      'read:website.CustomerAccount',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (!cart || cart.siteId !== args.siteId) return failure(problem('cart', 'cartUnavailable'))
      if (cart.accountId !== args.accountId) return failure(problem('cart', 'cartUnavailable'))
      if (cart.status === 'ordered')
        return {
          ok: true,
          order: { id: cart.orderId, name: cart.orderName, replayed: true },
        }
      if (cart.status !== 'open') return failure(problem('cart', 'cartUnavailable'))
      const settings = await settingsFor(ctx, args.siteId)
      if (!settings) return failure(problem('siteId', 'orderingUnavailable'))
      const lines = await linesOf(ctx, cart.id)
      if (!lines.length) return failure(problem('cart', 'emptyCart'))
      const customerName = args.customerName ? String(args.customerName).trim() : null
      if (customerName && customerName.length > 200) return failure(problem('customerName', 'invalidName'))
      const customerPhone = args.customerPhone ? String(args.customerPhone).trim() : null
      if (customerPhone && (customerPhone.length > 50 || !/^[+()\d\s.-]+$/.test(customerPhone)))
        return failure(problem('customerPhone', 'invalidPhone'))
      const note = args.note ? String(args.note).trim() : null
      if (note && note.length > 5_000) return failure(problem('note', 'noteTooLong'))
      // Resolved before the transaction so a product that went off sale between
      // cart and checkout is a refusal rather than a half-written order.
      const resolved: Array<{ line: Row; uomId: unknown }> = []
      for (const line of lines) {
        const held = await sellable(ctx, args.siteId, line.productId)
        if (!held) return failure(problem('productId', 'productUnavailable', { productId: line.productId }))
        resolved.push({ line, uomId: held.template.uomId ?? settings.defaultUomId })
      }
      return await ctx.tx(async (tx) => {
        const created = (await saleFunctions.createOrder!.handler(tx, {
          id: args.orderId,
          partnerId: args.partnerId,
          warehouseId: settings.warehouseId,
          pricelistId: settings.pricelistId ?? undefined,
          clientOrderRef: String(cart.id),
          notes: note ?? undefined,
        })) as Row
        if (created.ok !== true) return rejected('cart', created)
        for (const [index, held] of resolved.entries()) {
          const added = (await saleFunctions.addLine!.handler(tx, {
            id: `${args.orderId}:${index}`,
            orderId: args.orderId,
            productId: held.line.productId,
            productUomQty: held.line.quantity,
            productUomId: held.uomId,
            sequence: (index + 1) * 10,
          })) as Row
          if (added.ok !== true) return rejected('productId', added)
        }
        if (settings.orderPolicy === 'confirm') {
          const confirmed = (await saleFunctions.confirmOrder!.handler(tx, { id: args.orderId })) as Row
          if (confirmed.ok !== true) return rejected('cart', confirmed)
        }
        const order = (await tx.db.select('sale.Order', { id: args.orderId }))[0]!
        await tx.db.update(
          'website_retail.Cart',
          { id: cart.id },
          {
            status: 'ordered',
            orderId: args.orderId,
            orderName: order.name,
            customerName,
            customerPhone,
            note,
            submittedAt: new Date().toISOString(),
          },
        )
        return {
          ok: true,
          order: {
            id: String(order.id),
            name: order.name,
            state: order.state,
            currency: order.currency,
            amountUntaxed: amount(order.amountUntaxed),
            amountTax: amount(order.amountTax),
            amountTotal: amount(order.amountTotal),
            replayed: false,
          },
        }
      })
    },
  }),

  listChannelOrders: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { partnerId: 'id', limit: 'int?', offset: 'int?' },
    output: { items: 'json', hasMore: 'bool' },
    effects: ['read:sale.Order'],
    handler: async (ctx: Ctx, args) => {
      const paging = page(args.limit, args.offset)
      const Order = ctx.table('sale.Order')
      const rows = await ctx.db.all(
        from(Order)
          .where(eq(Order.partnerId, args.partnerId))
          .orderBy(asc(Order.dateOrder), asc(Order.id))
          .limit(paging.limit + 1)
          .offset(paging.offset),
      )
      return {
        items: rows.slice(0, paging.limit).map((order) => ({
          id: String(order.id),
          name: order.name,
          state: order.state,
          dateOrder: order.dateOrder,
          currency: order.currency,
          amountTotal: amount(order.amountTotal),
          invoiceStatus: order.invoiceStatus,
        })),
        hasMore: rows.length > paging.limit,
      }
    },
  }),

  /** Scoped by partner in the query, so a guessed order id reads nothing. */
  getChannelOrder: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { id: 'id', partnerId: 'id' },
    output: { ok: 'bool', order: 'json?', errors: 'json?' },
    effects: ['read:sale.Order', 'read:sale.OrderLine'],
    handler: async (ctx: Ctx, args) => {
      const Order = ctx.table('sale.Order')
      const order = await ctx.db.one(
        from(Order).where(eq(Order.id, args.id), eq(Order.partnerId, args.partnerId)),
      )
      if (!order) return failure(problem('id', 'orderNotFound'))
      const lines = await ctx.db.select('sale.OrderLine', { orderId: order.id })
      return {
        ok: true,
        order: {
          id: String(order.id),
          name: order.name,
          state: order.state,
          dateOrder: order.dateOrder,
          currency: order.currency,
          amountUntaxed: amount(order.amountUntaxed),
          amountTax: amount(order.amountTax),
          amountTotal: amount(order.amountTotal),
          invoiceStatus: order.invoiceStatus,
          lines: lines.map((line) => ({
            id: String(line.id),
            productId: String(line.productId),
            name: line.name,
            quantity: amount(line.productUomQty),
            unitPrice: amount(line.priceUnit),
            discount: amount(line.discount),
            subtotal: amount(line.priceSubtotal),
            quantityDelivered: amount(line.qtyDelivered),
          })),
        },
      }
    },
  }),
}
