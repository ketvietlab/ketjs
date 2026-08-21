import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { canManageStructure } from '../website/access.ts'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 24, 1), 100),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})

const retailSite = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const site = (await ctx.db.select('website.Site', { id }))[0] ?? null
  return site?.active === true && (site.theme === 'theme_retail' || site.siteGroup === 'retail') ? site : null
}

type Decimal = { units: bigint; scale: number }
const decimal = (value: unknown, maxScale = 6): Decimal | null => {
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(String(value ?? ''))
  if (!match || (match[2]?.length ?? 0) > maxScale) return null
  const fraction = match[2] ?? ''
  return { units: BigInt(`${match[1]}${fraction}`), scale: fraction.length }
}
const cartTotal = (lines: Row[]): string => {
  const amounts = lines.map((line) => {
    const quantity = decimal(line.quantity) ?? { units: 0n, scale: 0 }
    const price = decimal(line.unitPrice) ?? { units: 0n, scale: 0 }
    return { units: quantity.units * price.units, scale: quantity.scale + price.scale }
  })
  const scale = amounts.reduce((max, amount) => Math.max(max, amount.scale), 0)
  const units = amounts.reduce((sum, amount) => sum + amount.units * 10n ** BigInt(scale - amount.scale), 0n)
  if (!scale) return String(units)
  const padded = String(units).padStart(scale + 1, '0')
  const rendered = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, '')
  return rendered || '0'
}

const cartOf = async (ctx: Ctx, token: unknown): Promise<Row | null> => {
  const raw = String(token ?? '')
  if (raw.length < 24 || raw.length > 200) return null
  const Cart = ctx.table('website_retail.Cart')
  const cart = await ctx.db.one(from(Cart).where(eq(Cart.tokenDigest, digest(raw))))
  return cart && new Date(String(cart.expiresAt)) > new Date() ? cart : null
}

export const functions: Record<string, FnSpec> = {
  listCatalog: defineFn({
    anonymous: true,
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      templateId: 'id',
      name: 'text',
      description: 'text?',
      listPrice: 'decimal',
      defaultCode: 'text?',
    },
    effects: [
      'read:website.Site',
      'read:website_retail.CatalogItem',
      'read:product.Template',
      'read:product.Product',
    ],
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return []
      const paging = page(args.limit, args.offset)
      const Catalog = ctx.table('website_retail.CatalogItem')
      const items = await ctx.db.all(
        from(Catalog)
          .where(eq(Catalog.siteId, args.siteId), eq(Catalog.active, true))
          .orderBy(asc(Catalog.position), asc(Catalog.id))
          .limit(paging.limit)
          .offset(paging.offset),
      )
      if (!items.length) return []
      const Product = ctx.table('product.Product')
      const products = await ctx.db.all(
        from(Product).where(
          inArray(
            Product.id,
            items.map((item) => item.productId),
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
      const productById = new Map(products.map((product) => [product.id, product]))
      const templateById = new Map(templates.map((template) => [template.id, template]))
      const rows = []
      for (const item of items) {
        const product = productById.get(item.productId)
        const template = product ? templateById.get(product.templateId) : null
        if (!product || !template) continue
        rows.push({
          id: product.id,
          templateId: template.id,
          name: template.name,
          description: template.description ?? null,
          listPrice: template.listPrice,
          defaultCode: product.defaultCode ?? null,
        })
      }
      return rows
    },
  }),

  saveCatalogItem: defineFn({
    input: { id: 'id', siteId: 'id', productId: 'id', active: 'bool?', position: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_retail.CatalogItem',
      'write:website_retail.CatalogItem',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return invalid('siteId', 'website_retail.error.invalidSite')
      if (!(await canManageStructure(ctx, args.siteId))) return invalid('siteId', 'website.error.forbidden')
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
      const template = product
        ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        : null
      if (product?.active !== true || template?.active !== true || template.saleOk !== true)
        return invalid('productId', 'website_retail.error.productUnavailable')
      const existing = (await ctx.db.select('website_retail.CatalogItem', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      const duplicate = (
        await ctx.db.select('website_retail.CatalogItem', {
          siteId: args.siteId,
          productId: args.productId,
        })
      ).find((item) => item.id !== args.id)
      if (duplicate) return invalid('productId', 'website_retail.error.duplicateProduct')
      const row = {
        id: args.id,
        siteId: args.siteId,
        productId: args.productId,
        active: args.active !== false,
        position: Math.min(Math.max(Number(args.position ?? 0), 0), 1_000_000),
      }
      if (existing) await ctx.db.update('website_retail.CatalogItem', { id: args.id }, row)
      else await ctx.db.insert('website_retail.CatalogItem', row)
      return { ok: true, id: args.id }
    },
  }),

  createCart: defineFn({
    anonymous: true,
    input: { siteId: 'id', currency: 'text?' },
    output: { ok: 'bool', id: 'id?', token: 'text?', errors: 'json?' },
    effects: ['read:website.Site', 'write:website_retail.Cart'],
    handler: async (ctx: Ctx, args) => {
      if (!(await retailSite(ctx, args.siteId))) return invalid('siteId', 'website_retail.error.invalidSite')
      const currency = String(args.currency ?? 'VND')
        .trim()
        .toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) return invalid('currency', 'website_retail.error.invalidCurrency')
      const id = randomUUID()
      const token = randomBytes(24).toString('base64url')
      await ctx.db.insert('website_retail.Cart', {
        id,
        siteId: args.siteId,
        tokenDigest: digest(token),
        status: 'open',
        currency,
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        note: null,
        submittedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      return { ok: true, id, token }
    },
  }),

  getCart: defineFn({
    anonymous: true,
    input: { token: 'text' },
    output: { cart: 'json', lines: 'json', total: 'decimal' },
    effects: ['read:website_retail.Cart', 'read:website_retail.CartLine'],
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (!cart) return null
      const lines = (await ctx.db.select('website_retail.CartLine', { cartId: cart.id })).slice(0, 100)
      return {
        cart: {
          id: cart.id,
          siteId: cart.siteId,
          status: cart.status,
          currency: cart.currency,
          submittedAt: cart.submittedAt ?? null,
          expiresAt: cart.expiresAt,
        },
        lines,
        total: cartTotal(lines),
      }
    },
  }),

  addCartLine: defineFn({
    anonymous: true,
    input: { token: 'text', productId: 'id', quantity: 'decimal?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website_retail.Cart',
      'read:website_retail.CartLine',
      'write:website_retail.CartLine',
      'read:website_retail.CatalogItem',
      'read:product.Product',
      'read:product.Template',
    ],
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (cart?.status !== 'open') return invalid('token', 'website_retail.error.cartUnavailable')
      const catalogItem = (
        await ctx.db.select('website_retail.CatalogItem', {
          siteId: cart.siteId,
          productId: args.productId,
          active: true,
        })
      )[0]
      if (!catalogItem) return invalid('productId', 'website_retail.error.productUnavailable')
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
      if (product?.active !== true) return invalid('productId', 'website_retail.error.productUnavailable')
      const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      if (template?.saleOk !== true || template.active !== true)
        return invalid('productId', 'website_retail.error.productUnavailable')
      const quantity = decimal(args.quantity ?? '1', 3)
      if (!quantity || quantity.units <= 0n || quantity.units > 10_000n * 10n ** BigInt(quantity.scale))
        return invalid('quantity', 'website_retail.error.invalidQuantity')
      const quantityText = String(args.quantity ?? '1')
      const Line = ctx.table('website_retail.CartLine')
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const existing = await ctx.db.one(
          from(Line).where(eq(Line.cartId, cart.id), eq(Line.productId, args.productId)),
        )
        if (existing) {
          const current = decimal(existing.quantity, 3)
          if (!current) return invalid('quantity', 'website_retail.error.invalidQuantity')
          const scale = Math.max(current.scale, quantity.scale)
          const units =
            current.units * 10n ** BigInt(scale - current.scale) +
            quantity.units * 10n ** BigInt(scale - quantity.scale)
          if (units > 10_000n * 10n ** BigInt(scale))
            return invalid('quantity', 'website_retail.error.invalidQuantity')
          const padded = String(units).padStart(scale + 1, '0')
          const next = scale
            ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, '')
            : padded
          const changed = await ctx.db.compareAndSet(
            'website_retail.CartLine',
            { id: existing.id },
            { quantity: existing.quantity },
            { quantity: next },
          )
          if ('dryRun' in changed || changed.matched) return { ok: true, id: existing.id }
          continue
        }
        const id = randomUUID()
        const inserted = await ctx.db.insertIfAbsent('website_retail.CartLine', {
          id,
          cartId: cart.id,
          productId: args.productId,
          name: template.name,
          quantity: quantityText,
          unitPrice: template.listPrice,
        })
        if ('dryRun' in inserted || inserted.inserted) return { ok: true, id }
      }
      return invalid('quantity', 'website_retail.error.cartConflict')
    },
  }),

  checkoutCart: defineFn({
    anonymous: true,
    input: {
      token: 'text',
      customerName: 'text',
      customerEmail: 'text',
      customerPhone: 'text?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website_retail.Cart', 'read:website_retail.CartLine', 'write:website_retail.Cart'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (cart?.status === 'submitted') return { ok: true, id: cart.id }
      if (cart?.status !== 'open') return invalid('token', 'website_retail.error.cartUnavailable')
      const lines = await ctx.db.select('website_retail.CartLine', { cartId: cart.id })
      if (lines.length === 0) return invalid('cart', 'website_retail.error.emptyCart')
      const customerName = String(args.customerName).trim()
      const customerEmail = String(args.customerEmail).trim().toLowerCase()
      const customerPhone = args.customerPhone ? String(args.customerPhone).trim() : null
      const note = args.note ? String(args.note).trim() : null
      if (!customerName || customerName.length > 200)
        return invalid('customerName', 'website_retail.error.invalidName')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 320)
        return invalid('customerEmail', 'website_retail.error.invalidEmail')
      if (customerPhone && (customerPhone.length > 50 || !/^[+()\d\s.-]+$/.test(customerPhone)))
        return invalid('customerPhone', 'website_retail.error.invalidPhone')
      if (note && note.length > 5_000) return invalid('note', 'website_retail.error.noteTooLong')
      const changed = await ctx.db.compareAndSet(
        'website_retail.Cart',
        { id: cart.id },
        { status: 'open' },
        {
          status: 'submitted',
          customerName,
          customerEmail,
          customerPhone,
          note,
          submittedAt: new Date().toISOString(),
        },
      )
      if (!('dryRun' in changed) && !changed.matched) {
        const latest = await cartOf(ctx, args.token)
        return latest?.status === 'submitted'
          ? { ok: true, id: cart.id }
          : invalid('cart', 'website_retail.error.cartConflict')
      }
      return { ok: true, id: cart.id }
    },
  }),
}
