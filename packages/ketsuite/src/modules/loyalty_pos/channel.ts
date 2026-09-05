import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { defineChannelRoute, routesOf, type PosIdentity } from '../channel_api/core.ts'
import {
  commandOptions,
  posCommandKey,
  posFailure,
  posNotFound,
  posOrderFor,
} from '../pos_channel/operations.ts'

type Req = Parameters<Route>[1]

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const integer = { type: 'integer', minimum: 0 }
const object = { type: 'object' }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: object },
})
const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}
const rewardParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, programId: string },
  required: ['id', 'programId'],
}
const reward = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rewardId: string,
    programId: string,
    description: string,
    rewardType: string,
    requiredPoints: string,
    discountAmount: string,
    productId: nullableString,
    productQuantity: { type: ['number', 'null'] },
  },
  required: [
    'rewardId',
    'programId',
    'description',
    'rewardType',
    'requiredPoints',
    'discountAmount',
    'productId',
    'productQuantity',
  ],
}
const program = {
  type: 'object',
  additionalProperties: false,
  properties: {
    programId: string,
    programName: string,
    programType: string,
    points: string,
    availablePoints: string,
    pointName: string,
    rewards: { type: 'array', items: reward },
  },
  required: ['programId', 'programName', 'programType', 'points', 'availablePoints', 'pointName', 'rewards'],
}
const application = {
  type: 'object',
  additionalProperties: false,
  properties: {
    programId: string,
    rewardId: nullableString,
    pointsEarned: string,
    pointsSpent: string,
    discountAmount: string,
    state: string,
  },
  required: ['programId', 'rewardId', 'pointsEarned', 'pointsSpent', 'discountAmount', 'state'],
}
const loyalty = {
  type: 'object',
  additionalProperties: false,
  properties: {
    orderId: string,
    revision: integer,
    state: string,
    pointsEarned: string,
    pointsSpent: string,
    programs: { type: 'array', items: program },
    applications: { type: 'array', items: application },
  },
  required: ['orderId', 'revision', 'state', 'pointsEarned', 'pointsSpent', 'programs', 'applications'],
}

const projectPrograms = (rows: Row[]) =>
  rows.map((row) => ({
    programId: String(row.programId),
    programName: String(row.programName),
    programType: String(row.programType),
    points: String(row.points ?? 0),
    availablePoints: String(row.availablePoints ?? 0),
    pointName: String(row.pointName),
    rewards: ((row.rewards as Row[] | undefined) ?? []).map((held) => ({
      rewardId: String(held.rewardId),
      programId: String(held.programId),
      description: String(held.description),
      rewardType: String(held.rewardType),
      requiredPoints: String(held.requiredPoints ?? 0),
      discountAmount: String(held.discountAmount ?? 0),
      productId: held.productId == null ? null : String(held.productId),
      productQuantity: held.productQuantity == null ? null : Number(held.productQuantity),
    })),
  }))

const loyaltyResult = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const order = await posOrderFor(ctx, url, req, id, identity)
  if (!order) return posNotFound(ctx, url, req)
  const [evaluated, state] = (await Promise.all([
    ctx.call('loyalty_pos.evaluateOrder', { orderId: id }, url, req),
    ctx.call('loyalty_pos.getOrderState', { orderId: id }, url, req),
  ])) as [Row, Row | null]
  if (evaluated.ok !== true) return posFailure(ctx, url, req, evaluated)
  return {
    data: {
      orderId: id,
      revision: Number(order.revision ?? 0),
      state: String(state?.state ?? 'draft'),
      pointsEarned: String(state?.pointsEarned ?? 0),
      pointsSpent: String(state?.pointsSpent ?? 0),
      programs: projectPrograms((evaluated.programs as Row[] | undefined) ?? []),
      applications: (state?.applications as Row[] | undefined) ?? [],
    },
    headers: { etag: `"pos-order-${Number(order.revision ?? 0)}-loyalty"` },
  }
}

const mutate = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  identity: PosIdentity,
  orderId: string,
  action: string,
  input: Row,
) => {
  if (!(await posOrderFor(ctx, url, req, orderId, identity))) return posNotFound(ctx, url, req)
  const key = posCommandKey(ctx, url, req)
  if (typeof key !== 'string') return key
  const result = (await ctx.call(
    `loyalty_pos.${action}`,
    input,
    url,
    req,
    commandOptions(identity, `order.loyalty.${action}`, key),
  )) as Row
  if (result.ok !== true) return posFailure(ctx, url, req, result)
  return loyaltyResult(ctx, url, req, orderId, identity)
}

const ifMatchRevision = (req: Req): number | null => {
  const header = req.headers['if-match']
  const value = Array.isArray(header) ? header[0] : header
  const match = /^"pos-order-(\d+)-loyalty"$/.exec(String(value ?? ''))
  if (!match) return null
  const revision = Number(match[1])
  return Number.isSafeInteger(revision) ? revision : null
}

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'orders/{id}/loyalty',
    operationId: 'pos.orders.loyalty.evaluate',
    summary: 'Evaluate current POS loyalty programs and applied rewards.',
    auth: 'required',
    capability: { key: 'pos.loyalty', action: 'read' },
    request: { params: idParams },
    responses: {
      '200': envelope(loyalty),
      '404': envelope(object),
      '422': envelope(object),
    },
    handler: (ctx, url, req, params, request) => loyaltyResult(ctx, url, req, params.id, request.identity!),
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/loyalty/codes',
    operationId: 'pos.orders.loyalty.codes.apply',
    summary: 'Apply one loyalty or promotion code under the order revision.',
    auth: 'required',
    capability: { key: 'pos.loyalty', action: 'apply_code' },
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, code: string },
        required: ['expectedRevision', 'code'],
      },
    },
    responses: {
      '200': envelope(loyalty),
      '400': envelope(object),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: (ctx, url, req, params, request) =>
      mutate(ctx, url, req, request.identity!, params.id, 'applyCode', {
        orderId: params.id,
        expectedRevision: request.body.expectedRevision,
        code: request.body.code,
      }),
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/loyalty/rewards',
    operationId: 'pos.orders.loyalty.rewards.apply',
    summary: 'Reserve and materialize one loyalty reward under the order revision.',
    auth: 'required',
    capability: { key: 'pos.loyalty', action: 'apply_reward' },
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          programId: string,
          rewardId: string,
          points: string,
        },
        required: ['expectedRevision', 'programId', 'rewardId'],
      },
    },
    responses: {
      '200': envelope(loyalty),
      '400': envelope(object),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: (ctx, url, req, params, request) =>
      mutate(ctx, url, req, request.identity!, params.id, 'applyReward', {
        orderId: params.id,
        expectedRevision: request.body.expectedRevision,
        programId: request.body.programId,
        rewardId: request.body.rewardId,
        ...(request.body.points === undefined ? {} : { points: request.body.points }),
      }),
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'DELETE',
    path: 'orders/{id}/loyalty/rewards/{programId}',
    operationId: 'pos.orders.loyalty.rewards.remove',
    summary: 'Release and remove one applied loyalty reward under the order revision.',
    auth: 'required',
    capability: { key: 'pos.loyalty', action: 'remove_reward' },
    request: {
      params: rewardParams,
      headers: {
        type: 'object',
        additionalProperties: false,
        properties: { 'If-Match': string },
        required: ['If-Match'],
      },
    },
    responses: {
      '200': envelope(loyalty),
      '400': envelope(object),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: (ctx, url, req, params, request) => {
      const expectedRevision = ifMatchRevision(req)
      if (expectedRevision === null)
        return posFailure(ctx, url, req, {
          ok: false,
          errors: [{ field: 'If-Match', message: 'a current POS Loyalty ETag is required' }],
        })
      return mutate(ctx, url, req, request.identity!, params.id, 'removeReward', {
        orderId: params.id,
        expectedRevision,
        programId: params.programId,
      })
    },
  }),
)
