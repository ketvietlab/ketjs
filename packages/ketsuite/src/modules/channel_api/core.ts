import { createHash, randomUUID } from 'node:crypto'
import { json, withHeaders } from '@ketvietlab/ketjs'
import type {
  HttpRouteContract,
  JsonSchema,
  Route,
  RouteEntry,
  RouteResult,
  ServeContext,
} from '@ketvietlab/ketjs'

export const CHANNEL_API_VERSION = '1.0.0'
export const CHANNEL_PROFILES = ['customer', 'staff', 'pos', 'integration'] as const
export type ChannelProfile = (typeof CHANNEL_PROFILES)[number]

export const profilePrefix = (profile: ChannelProfile): string => `/api/${profile}/v1/`

type Req = Parameters<Route>[1]
type Params = Parameters<Route>[2]

export type ChannelError = {
  code: string
  messageKey: string
  params: Record<string, unknown>
  message: string
  retryable: boolean
  fieldErrors: Record<string, { code: string; messageKey: string; params: Record<string, unknown> }>
  details: Record<string, unknown>
}

export type ChannelOutcome = {
  status?: number
  data?: unknown
  error?: ChannelError
  headers?: Record<string, string>
  nextCursor?: string | null
}

export type ChannelRouteSpec = {
  profile: ChannelProfile
  method: HttpRouteContract['method']
  path: string
  operationId: string
  summary?: string
  capability?: { key: string; action: string }
  request?: HttpRouteContract['request']
  responses: Record<string, JsonSchema>
  idempotent?: boolean
  handler: (
    ctx: ServeContext,
    url: URL,
    req: Req,
    params: Params,
    requestId: string,
  ) => ChannelOutcome | Promise<ChannelOutcome>
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/
const requestIdOf = (req: Req): string => {
  const supplied = String(req.headers['x-request-id'] ?? '').trim()
  return REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID()}`
}

const privateHeaders = {
  'cache-control': 'private, no-store',
  vary: 'Accept-Language, Authorization, Cookie',
}

export const channelError = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  code: string,
  options: {
    messageKey?: string
    params?: Record<string, unknown>
    retryable?: boolean
    fieldErrors?: ChannelError['fieldErrors']
    details?: Record<string, unknown>
  } = {},
): ChannelError => {
  const messageKey = options.messageKey ?? code
  const params = options.params ?? {}
  return {
    code,
    messageKey,
    params,
    message: ctx.translate(ctx.localeOf(url, req))(messageKey, params),
    retryable: options.retryable === true,
    fieldErrors: options.fieldErrors ?? {},
    details: options.details ?? {},
  }
}

export const defineChannelRoute = (spec: ChannelRouteSpec): [string, RouteEntry] => {
  const prefix = profilePrefix(spec.profile)
  const local = spec.path.replace(/^\/+/, '')
  if (!local || local.includes('..')) throw new Error(`invalid channel route path: ${spec.path}`)
  if (!spec.operationId.startsWith(`${spec.profile}.`))
    throw new Error(`channel operationId must start with "${spec.profile}."`)
  if (spec.capability && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(spec.capability.key))
    throw new Error(`invalid capability key: ${spec.capability.key}`)
  const path = `${prefix}${local}`
  const contract: HttpRouteContract = {
    profile: spec.profile,
    method: spec.method,
    operationId: spec.operationId,
    ...(spec.summary ? { summary: spec.summary } : {}),
    ...(spec.capability ? { capability: spec.capability } : {}),
    ...(spec.request ? { request: spec.request } : {}),
    responses: spec.responses,
    ...(spec.idempotent ? { idempotent: true } : {}),
  }
  return [
    path,
    {
      anonymous: true,
      through: 'channel_api',
      contract,
      handler:
        (ctx: ServeContext): Route =>
        async (url, req, params) => {
          const requestId = requestIdOf(req)
          if (req.method !== spec.method) {
            const error = channelError(ctx, url, req, 'channel_api.methodNotAllowed', {
              messageKey: 'channel_api.error.methodNotAllowed',
              params: { method: spec.method },
            })
            return withHeaders(
              json(
                {
                  data: null,
                  error,
                  meta: { requestId, serverTime: new Date().toISOString(), nextCursor: null },
                },
                { status: 405 },
              ),
              { ...privateHeaders, allow: spec.method, 'x-request-id': requestId },
            )
          }
          try {
            const outcome = await spec.handler(ctx, url, req, params, requestId)
            return withHeaders(
              json(
                {
                  data: outcome.error ? null : (outcome.data ?? null),
                  error: outcome.error ?? null,
                  meta: {
                    requestId,
                    serverTime: new Date().toISOString(),
                    nextCursor: outcome.nextCursor ?? null,
                  },
                },
                { status: outcome.status ?? (outcome.error ? 400 : 200) },
              ),
              { ...privateHeaders, 'x-request-id': requestId, ...(outcome.headers ?? {}) },
            )
          } catch (cause) {
            const code = (cause as { code?: string }).code
            const conflict = code === 'E_IDEMPOTENCY_CONFLICT'
            const clientError =
              code === 'E_MEDIA_TYPE'
                ? { status: 415, code: 'channel_api.unsupportedMediaType' }
                : code === 'E_PAYLOAD_TOO_LARGE'
                  ? { status: 413, code: 'channel_api.payloadTooLarge' }
                  : code === 'E_INVALID_BODY'
                    ? { status: 400, code: 'channel_api.invalidBody' }
                    : null
            const error = channelError(
              ctx,
              url,
              req,
              conflict
                ? 'channel_api.idempotencyConflict'
                : (clientError?.code ?? 'channel_api.internalError'),
              {
                messageKey: conflict
                  ? 'channel_api.error.idempotencyConflict'
                  : `${clientError?.code ?? 'channel_api'}.error${clientError ? '' : '.internal'}`,
                retryable: !conflict && !clientError && spec.idempotent === true,
              },
            )
            return withHeaders(
              json(
                {
                  data: null,
                  error,
                  meta: { requestId, serverTime: new Date().toISOString(), nextCursor: null },
                },
                { status: conflict ? 409 : (clientError?.status ?? 500) },
              ),
              { ...privateHeaders, 'x-request-id': requestId },
            )
          }
        },
    },
  ]
}

export const routesOf = (...routes: Array<[string, RouteEntry]>): Record<string, RouteEntry> =>
  Object.fromEntries(routes)

export const readJson = async (req: Req, limit = 32 * 1024): Promise<Record<string, unknown>> => {
  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!type.includes('application/json'))
    throw Object.assign(new Error('unsupported media type'), { code: 'E_MEDIA_TYPE' })
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit)
    throw Object.assign(new Error('payload too large'), { code: 'E_PAYLOAD_TOO_LARGE' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > limit) throw Object.assign(new Error('payload too large'), { code: 'E_PAYLOAD_TOO_LARGE' })
    chunks.push(bytes)
  }
  let value: unknown
  try {
    value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('body must be valid JSON'), { code: 'E_INVALID_BODY' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('body must be an object'), { code: 'E_INVALID_BODY' })
  return value as Record<string, unknown>
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const bearerOf = (req: Req): string | null => {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization ?? '').trim())
  return match?.[1] && match[1].length >= 32 && match[1].length <= 512 ? match[1] : null
}

export const stableHash = (value: unknown): string => {
  const canonical = (held: unknown): string => {
    if (held === null || typeof held !== 'object') return JSON.stringify(held)
    if (Array.isArray(held)) return `[${held.map(canonical).join(',')}]`
    return `{${Object.entries(held as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return sha256(canonical(value))
}

export type { RouteResult }
