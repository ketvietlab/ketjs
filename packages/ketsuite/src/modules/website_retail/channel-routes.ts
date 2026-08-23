// The retail storefront's Channel API surface.
//
// Every route here is a thin projection of website_retail's storefront
// functions: resolve which site the caller is on, hand the domain what it needs,
// and shape the answer. Authentication, CSRF and request-body validation are the
// facade's, so none of it is repeated below.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelCommandId, channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
import type { ChannelIdentity } from '../channel_api/core.ts'
import { channelRealmContext } from '../channel_api/customer.ts'

type Req = Parameters<Route>[1]
type Issue = { field?: string; code?: string; messageKey?: string; params?: Record<string, unknown> }

const object = { type: 'object' }
const envelope = { type: 'object', properties: { data: {}, error: {}, meta: object } }
const string = { type: 'string' }
const body = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})

/** How far a storefront failure is from being the caller's fault. */
const STATUS: Record<string, number> = {
  invalidSite: 404,
  productUnavailable: 404,
  cartUnavailable: 404,
  orderNotFound: 404,
  orderingUnavailable: 409,
  orderRejected: 409,
  cartFull: 409,
}

const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const offsetOf = (cursor: string | null): number => {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')

const cartToken = (req: Req): string => String(req.headers['x-cart-token'] ?? '').trim()

/** A signed-in caller carries their own site; anyone else gets the one this host serves. */
const siteOf = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  identity: ChannelIdentity | null,
): Promise<string | null> => {
  if (identity?.siteId) return identity.siteId
  return (await channelRealmContext(ctx, url, req))?.siteId ?? null
}

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown, fallback = 422) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Issue[] }).errors ?? [])
    : []
  const first = issues[0] ?? {}
  const messageKey = first.messageKey ?? 'channel_api.error.internal'
  const code = first.code ? `website_retail.${first.code}` : 'website_retail.invalidRequest'
  return {
    status: first.code ? (STATUS[first.code] ?? fallback) : fallback,
    error: channelError(ctx, url, req, code, {
      messageKey,
      params: first.params ?? {},
      fieldErrors: Object.fromEntries(
        issues
          .filter((issue) => issue.field)
          .map((issue) => [
            String(issue.field),
            {
              code: issue.code ? `website_retail.${issue.code}` : code,
              messageKey: issue.messageKey ?? messageKey,
              params: issue.params ?? {},
            },
          ]),
      ),
    }),
  }
}

const noSite = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'website_retail.invalidSite', {
    messageKey: 'website_retail.error.invalidSite',
  }),
})

const noCartToken = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 400,
  error: channelError(ctx, url, req, 'website_retail.cartTokenRequired', {
    messageKey: 'website_retail.error.cartTokenRequired',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/storefront',
    operationId: 'customer.retail.storefront',
    summary: 'Resolve the retail store this host serves and whether it can take orders.',
    auth: 'optional-customer',
    capability: { key: 'website_retail.storefront', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const result = (await ctx.callUnchecked('website_retail.channelStorefront', { siteId }, url, req)) as {
        ok?: boolean
        storefront?: unknown
      }
      return result.ok ? { data: result.storefront } : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/products',
    operationId: 'customer.retail.products.list',
    summary: 'List the products published by the resolved retail site.',
    auth: 'optional-customer',
    capability: { key: 'website_retail.products', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const limit = positive(url.searchParams.get('limit'), 24, 100)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const result = (await ctx.callUnchecked(
        'website_retail.listChannelProducts',
        { siteId, limit, offset },
        url,
        req,
      )) as { items: unknown[]; hasMore: boolean }
      return { data: result.items, nextCursor: result.hasMore ? cursorOf(offset + limit) : null }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/products/{id}',
    operationId: 'customer.retail.products.get',
    auth: 'optional-customer',
    capability: { key: 'website_retail.products', action: 'read' },
    request: { params: { type: 'object', properties: { id: string }, required: ['id'] } },
    responses: { '200': envelope },
    handler: async (ctx, url, req, params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'website_retail.getChannelProduct',
        { siteId, productId: params.id },
        url,
        req,
      )) as { ok?: boolean; product?: unknown }
      return result.ok ? { data: result.product } : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'retail/carts',
    operationId: 'customer.retail.carts.start',
    summary: 'Start a cart, or re-issue a token for the signed-in shopper’s open cart.',
    auth: 'optional-customer',
    capability: { key: 'website_retail.cart', action: 'write' },
    request: { body: body({ currency: string }, []) },
    responses: { '201': envelope },
    rateLimit: { action: 'retail.cart.start', limit: 60, windowMs: 60 * 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'website_retail.startChannelCart',
        {
          siteId,
          accountId: request.identity?.accountId ?? null,
          currency: request.body.currency ?? null,
        },
        url,
        req,
      )) as { ok?: boolean; cart?: unknown; token?: string }
      return result.ok
        ? { status: 201, data: { cart: result.cart, cartToken: result.token } }
        : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/cart',
    operationId: 'customer.retail.cart.get',
    summary: 'Read the cart named by X-Cart-Token, or the signed-in shopper’s open cart.',
    auth: 'optional-customer',
    capability: { key: 'website_retail.cart', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const token = cartToken(req)
      if (!token && !request.identity) return noCartToken(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'website_retail.resolveChannelCart',
        { siteId, token: token || null, accountId: request.identity?.accountId ?? null },
        url,
        req,
      )) as { ok?: boolean; cart?: unknown }
      return result.ok ? { data: result.cart } : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'PUT',
    path: 'retail/cart/lines',
    operationId: 'customer.retail.cart.lines.set',
    summary: 'Set one product to an absolute quantity; zero removes it.',
    auth: 'optional-customer',
    capability: { key: 'website_retail.cart', action: 'write' },
    request: { body: body({ productId: string, quantity: string }, ['productId', 'quantity']) },
    responses: { '200': envelope },
    rateLimit: { action: 'retail.cart.write', limit: 240, windowMs: 60 * 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const siteId = await siteOf(ctx, url, req, request.identity)
      if (!siteId) return noSite(ctx, url, req)
      const token = cartToken(req)
      if (!token) return noCartToken(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'website_retail.setChannelCartLine',
        {
          siteId,
          token,
          accountId: request.identity?.accountId ?? null,
          productId: request.body.productId,
          quantity: request.body.quantity,
        },
        url,
        req,
      )) as { ok?: boolean; cart?: unknown }
      return result.ok ? { data: result.cart } : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'retail/cart/claim',
    operationId: 'customer.retail.cart.claim',
    summary: 'Attach a guest cart to the signed-in shopper, folding in what they already had.',
    auth: 'customer',
    capability: { key: 'website_retail.cart', action: 'write' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      const siteId = await siteOf(ctx, url, req, identity)
      if (!siteId) return noSite(ctx, url, req)
      const token = cartToken(req)
      if (!token) return noCartToken(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'website_retail.claimChannelCart',
        { siteId, token, accountId: identity.accountId },
        url,
        req,
      )) as { ok?: boolean; cart?: unknown; merged?: boolean }
      return result.ok
        ? { data: { cart: result.cart, merged: result.merged === true } }
        : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'retail/checkout',
    operationId: 'customer.retail.checkout',
    summary: 'Turn the claimed cart into a sales order.',
    auth: 'customer',
    capability: { key: 'website_retail.orders', action: 'create' },
    request: {
      body: body({ customerName: string, customerPhone: string, note: string }, []),
    },
    responses: { '201': envelope },
    idempotent: true,
    rateLimit: { action: 'retail.checkout', limit: 20, windowMs: 60 * 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      const siteId = await siteOf(ctx, url, req, identity)
      if (!siteId) return noSite(ctx, url, req)
      const token = cartToken(req)
      if (!token) return noCartToken(ctx, url, req)
      const key = String(req.headers['idempotency-key'] ?? '').trim()
      if (!key)
        return {
          status: 400,
          error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
            messageKey: 'channel_api.error.idempotencyRequired',
          }),
        }
      const result = (await ctx.callUnchecked(
        'website_retail.submitChannelCart',
        {
          orderId: channelCommandId('channel', identity, key),
          siteId,
          token,
          accountId: identity.accountId,
          partnerId: identity.account.partnerId,
          customerName: request.body.customerName ?? null,
          customerPhone: request.body.customerPhone ?? null,
          note: request.body.note ?? null,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: `customer:${identity.realmId}:${identity.accountId}:retail-order`,
        },
      )) as { ok?: boolean; order?: { replayed?: boolean } }
      if (!result.ok) return domainFailure(ctx, url, req, result, 409)
      return { status: result.order?.replayed ? 200 : 201, data: result.order }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/orders',
    operationId: 'customer.retail.orders.list',
    auth: 'customer',
    capability: { key: 'website_retail.orders', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const limit = positive(url.searchParams.get('limit'), 24, 100)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const result = (await ctx.callUnchecked(
        'website_retail.listChannelOrders',
        { partnerId: request.identity!.account.partnerId, limit, offset },
        url,
        req,
      )) as { items: unknown[]; hasMore: boolean }
      return { data: result.items, nextCursor: result.hasMore ? cursorOf(offset + limit) : null }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'retail/orders/{id}',
    operationId: 'customer.retail.orders.get',
    auth: 'customer',
    capability: { key: 'website_retail.orders', action: 'read' },
    request: { params: { type: 'object', properties: { id: string }, required: ['id'] } },
    responses: { '200': envelope },
    handler: async (ctx, url, req, params, request) => {
      const result = (await ctx.callUnchecked(
        'website_retail.getChannelOrder',
        { id: params.id, partnerId: request.identity!.account.partnerId },
        url,
        req,
      )) as { ok?: boolean; order?: unknown }
      return result.ok ? { data: result.order } : domainFailure(ctx, url, req, result, 404)
    },
  }),
)
