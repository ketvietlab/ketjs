import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

const cartOf = async (ctx: Ctx, token: unknown): Promise<Row | null> => {
  const Cart = ctx.table('website_retail.Cart')
  return ctx.db.one(from(Cart).where(eq(Cart.tokenDigest, digest(String(token)))))
}

export const functions: Record<string, FnSpec> = {
  listCatalog: defineFn({
    anonymous: true,
    input: { limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      templateId: 'id',
      name: 'text',
      description: 'text?',
      listPrice: 'decimal',
      defaultCode: 'text?',
    },
    effects: ['read:product.Template', 'read:product.Product'],
    handler: async (ctx: Ctx, args) => {
      const Template = ctx.table('product.Template')
      let query = from(Template)
        .where(eq(Template.active, true), eq(Template.saleOk, true))
        .orderBy(asc(Template.name))
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
      const templates = await ctx.db.all(query)
      const products = await ctx.db.select('product.Product')
      return templates.flatMap((template) => {
        const product = products.find(
          (candidate) => candidate.templateId === template.id && candidate.active === true,
        )
        return product
          ? [
              {
                id: product.id,
                templateId: template.id,
                name: template.name,
                description: template.description ?? null,
                listPrice: template.listPrice,
                defaultCode: product.defaultCode ?? null,
              },
            ]
          : []
      })
    },
  }),

  createCart: defineFn({
    anonymous: true,
    input: { siteId: 'id', currency: 'text?' },
    output: { ok: 'bool', id: 'id?', token: 'text?', errors: 'json?' },
    effects: ['read:website.Site', 'write:website_retail.Cart'],
    handler: async (ctx: Ctx, args) => {
      if (!(await ctx.db.select('website.Site', { id: args.siteId }))[0])
        return invalid('siteId', 'site does not exist')
      const id = randomUUID()
      const token = randomBytes(24).toString('base64url')
      await ctx.db.insert('website_retail.Cart', {
        id,
        siteId: args.siteId,
        tokenDigest: digest(token),
        status: 'open',
        currency: String(args.currency ?? 'VND').toUpperCase(),
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        note: null,
        submittedAt: null,
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
      const lines = await ctx.db.select('website_retail.CartLine', { cartId: cart.id })
      const total = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0)
      return { cart, lines, total: String(total) }
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
      'read:product.Product',
      'read:product.Template',
    ],
    handler: async (ctx: Ctx, args) => {
      const cart = await cartOf(ctx, args.token)
      if (cart?.status !== 'open') return invalid('token', 'cart is not available')
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
      if (product?.active !== true) return invalid('productId', 'product is not available')
      const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      if (template?.saleOk !== true || template.active !== true)
        return invalid('productId', 'product is not for sale')
      const quantity = Number(args.quantity ?? 1)
      if (!Number.isFinite(quantity) || quantity <= 0) return invalid('quantity', 'must be positive')
      const Line = ctx.table('website_retail.CartLine')
      const existing = await ctx.db.one(
        from(Line).where(eq(Line.cartId, cart.id), eq(Line.productId, args.productId)),
      )
      if (existing)
        await ctx.db.update(
          'website_retail.CartLine',
          { id: existing.id },
          { quantity: String(Number(existing.quantity) + quantity) },
        )
      else {
        const id = randomUUID()
        await ctx.db.insert('website_retail.CartLine', {
          id,
          cartId: cart.id,
          productId: args.productId,
          name: template.name,
          quantity: String(quantity),
          unitPrice: template.listPrice,
        })
        return { ok: true, id }
      }
      return { ok: true, id: existing.id }
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
      if (cart?.status !== 'open') return invalid('token', 'cart is not available')
      const lines = await ctx.db.select('website_retail.CartLine', { cartId: cart.id })
      if (lines.length === 0) return invalid('cart', 'cart is empty')
      if (!String(args.customerName).trim()) return invalid('customerName', 'required')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(args.customerEmail)))
        return invalid('customerEmail', 'invalid email')
      await ctx.db.update(
        'website_retail.Cart',
        { id: cart.id },
        {
          status: 'submitted',
          customerName: String(args.customerName).trim(),
          customerEmail: String(args.customerEmail).trim().toLowerCase(),
          customerPhone: args.customerPhone ?? null,
          note: args.note ?? null,
          submittedAt: new Date().toISOString(),
        },
      )
      return { ok: true, id: cart.id }
    },
  }),
}
