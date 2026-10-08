// HTTP bindings at run time: `httpRoutes()` and the route that answers for them.
//
// A binding publishes a server function as an ordinary HTTP operation — a method,
// a path, query parameters or a JSON body — without a second implementation of
// what the function already decides. Permission, validation, idempotency and
// projection stay where they are, behind `ctx.call`; this route only translates
// the request into the function's input and the result into a response, and it
// checks both against the contract composition derived, so the document a client
// reads and the route it calls cannot disagree.

import { randomUUID } from 'node:crypto'
import { STATUS_CODES } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { ValidationIssue } from '@ketvietlab/ketjs-view'
import { parseDecimal } from '../data/changeset.ts'
import { KetError } from '../kernel/errors.ts'
import {
  BODY_METHODS,
  HTTP_METHODS,
  IDEMPOTENCY_KEY_SCHEMA,
  markBindingHandler,
} from '../kernel/http-binding.ts'
import { validateJson } from '../kernel/json-schema-subset.ts'
import type { RouteParams } from '../kernel/routes.ts'
import { FormValidationError } from './form.ts'
import { json, text, withHeaders } from './respond.ts'
import type { RouteResult } from './respond.ts'
import type { Route, ServeContext } from './boot.ts'
import type {
  FnReturns,
  HttpBindingAuth,
  HttpBindingError,
  HttpBindingIdentityValue,
  HttpBindingMeta,
  HttpBindingSpec,
  HttpMethod,
  JsonSchema,
  RouteEntry,
} from '../types.ts'

/** What every endpoint of one `httpRoutes()` call shares. */
export type HttpRouteGroup = {
  /** The API surface the operations belong to; generators select by it. */
  profile: string
  /** Prepended to every endpoint path, such as `/api/v1`. */
  prefix?: string
  /** Defaults to `required`. */
  auth?: HttpBindingAuth
  /** `data` (the default) answers `{ "data": value }`; `none` answers the value itself. */
  envelope?: 'data' | 'none'
  /** Business error codes every endpoint maps; an endpoint's own entry wins. */
  errors?: Record<string, number | HttpBindingError>
  /** The prefix owner whose published factory contributes these routes. */
  through?: string
  /** Largest JSON body accepted, in bytes. Defaults to 1 MiB. */
  maxBodyBytes?: number
}

/** One operation. A string is shorthand for `{ call }`. */
export type HttpEndpoint =
  | string
  | {
      call: string
      auth?: HttpBindingAuth
      status?: 200 | 201
      params?: Record<string, string>
      bind?: Record<string, HttpBindingIdentityValue>
      returns?: FnReturns
      idempotency?: 'optional' | 'required'
      operationId?: string
      summary?: string
      schemas?: { input?: Record<string, JsonSchema>; output?: Record<string, JsonSchema> }
      errors?: Record<string, number | HttpBindingError>
      maxBodyBytes?: number
    }

const definitionError = (code: string, message: string, hint?: string): KetError =>
  new KetError({ code, module: 'http', message, hint })

/**
 * Publish server functions as HTTP operations.
 *
 * Endpoints are keyed `"METHOD /path"`. Composition checks each one against its
 * function and derives the route's contract; mistakes visible from the declaration
 * alone are refused here, where they were written.
 */
export function httpRoutes(
  group: HttpRouteGroup,
  endpoints: Record<string, HttpEndpoint>,
): Record<string, RouteEntry> {
  if (typeof group?.profile !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(group.profile))
    throw definitionError(
      'E_HTTP_BINDING_PROFILE',
      `httpRoutes() needs a profile name, got ${JSON.stringify(group?.profile)}`,
      'use lowercase letters, digits, "_" and "-", starting with a letter',
    )
  const prefix = group.prefix ?? ''
  if (prefix && (!prefix.startsWith('/') || prefix.endsWith('/')))
    throw definitionError('E_HTTP_BINDING_KEY', `prefix "${prefix}" must start with "/" and not end with one`)

  const routes: Record<string, RouteEntry> = {}
  const methodOf = new Map<string, string>()
  for (const [key, endpoint] of Object.entries(endpoints)) {
    const match = /^([A-Z]+) (\/\S*)$/.exec(key)
    if (!match) throw definitionError('E_HTTP_BINDING_KEY', `endpoint "${key}" is not "METHOD /path"`)
    const method = match[1] as HttpMethod
    if (!HTTP_METHODS.includes(method))
      throw definitionError(
        'E_HTTP_BINDING_METHOD',
        `endpoint "${key}" uses unsupported method "${method}"`,
        `use ${HTTP_METHODS.join(', ')}`,
      )
    const path = `${prefix}${prefix && match[2] === '/' ? '' : match[2]}`
    const taken = methodOf.get(path)
    if (taken)
      throw definitionError(
        'E_HTTP_BINDING_METHOD_CONFLICT',
        `"${taken} ${path}" and "${method} ${path}" share one path`,
        'a path publishes one operation; give the second its own path',
      )
    methodOf.set(path, method)
    const declared = typeof endpoint === 'string' ? { call: endpoint } : endpoint
    if (typeof declared?.call !== 'string' || !declared.call)
      throw definitionError('E_HTTP_BINDING_KEY', `endpoint "${key}" names no function to call`)
    const errors = { ...group.errors, ...declared.errors }
    const maxBodyBytes = declared.maxBodyBytes ?? group.maxBodyBytes
    const binding: HttpBindingSpec = {
      profile: group.profile,
      method,
      path,
      call: declared.call,
      auth: declared.auth ?? group.auth ?? 'required',
      envelope: group.envelope ?? 'data',
      ...(declared.status === undefined ? {} : { status: declared.status }),
      ...(declared.params ? { params: declared.params } : {}),
      ...(declared.bind ? { bind: declared.bind } : {}),
      ...(declared.returns === undefined ? {} : { returns: declared.returns }),
      ...(declared.idempotency === undefined ? {} : { idempotency: declared.idempotency }),
      ...(declared.operationId === undefined ? {} : { operationId: declared.operationId }),
      ...(declared.summary === undefined ? {} : { summary: declared.summary }),
      ...(declared.schemas ? { schemas: declared.schemas } : {}),
      ...(Object.keys(errors).length ? { errors } : {}),
      ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
    }
    routes[path] = {
      // Open at the framework gate so a stranger gets this route's 401 envelope rather
      // than a sign-in redirect; the route enforces `auth` itself before anything else.
      anonymous: true,
      ...(group.through ? { through: group.through } : {}),
      binding,
      handler: bindingHandler(path),
    }
  }
  return routes
}

const bindingHandler = (path: string): ((ctx: ServeContext) => Route) =>
  markBindingHandler((ctx: ServeContext): Route => {
    const binding = ctx.manifest.routes[path]?.binding
    if (!binding)
      throw new KetError({
        code: 'E_HTTP_BINDING_FORGED',
        module: 'http',
        message: `route "${path}" was not composed as a function binding`,
      })
    return (url, req, params) => answer(ctx, path, binding, url, req, params)
  }, path)

/** A refusal the route decides itself, before or around the call. */
class Refusal extends Error {
  readonly status: number
  readonly code: string
  readonly headers: Record<string, string>
  constructor(status: number, code: string, headers: Record<string, string> = {}) {
    super(code)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

// What a client is told for a code whose status the framework fixes. Never the
// error's own message: that is written for the server log and may name internals.
const FIXED: Readonly<Record<string, { status: number; message: string }>> = {
  E_HTTP_IDEMPOTENCY_UNSUPPORTED: {
    status: 400,
    message: 'this operation does not accept an Idempotency-Key header',
  },
  E_HTTP_UNAUTHENTICATED: { status: 401, message: 'authentication required' },
  E_FN_NOT_PERMITTED: { status: 403, message: 'not permitted' },
  E_HTTP_CSRF: { status: 403, message: 'cross-site request refused' },
  E_NOT_FOUND: { status: 404, message: 'not found' },
  E_HTTP_METHOD: { status: 405, message: 'method not allowed' },
  E_IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'the idempotency key was already used with a different request',
  },
  E_IDEMPOTENCY_IN_FLIGHT: { status: 409, message: 'a request with this idempotency key is still running' },
  E_PAYLOAD_TOO_LARGE: { status: 413, message: 'the request body is too large' },
  E_HTTP_CONTENT_TYPE: { status: 415, message: 'the request body must be application/json' },
  E_INVALID_INPUT: { status: 422, message: 'the request is invalid' },
  E_HTTP_INVALID_REQUEST: { status: 422, message: 'the request is invalid' },
  E_HTTP_IDEMPOTENCY_REQUIRED: { status: 428, message: 'an Idempotency-Key header is required' },
  E_INTERNAL: { status: 500, message: 'internal error' },
}

const isJsonType = (header: unknown): boolean => {
  const media = String(header ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
  return media === 'application/json' || (media.startsWith('application/') && media.endsWith('+json'))
}

/**
 * A cookie rides along with any request a browser makes, so an operation that acts
 * on one must know the page asking is this site's own. A bearer token does not
 * ride along, which is why only a cookie session is checked.
 */
const sameOrigin = (url: URL, req: IncomingMessage): boolean => {
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      return new URL(origin).host === url.host
    } catch {
      return false // `Origin: null` comes from a sandboxed or opaque page
    }
  }
  return req.headers['sec-fetch-site'] === 'same-origin'
}

const readBody = async (req: IncomingMessage, maxBytes: number): Promise<Buffer> => {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw new Refusal(413, 'E_PAYLOAD_TOO_LARGE')
  const chunks: Buffer[] = []
  let total = 0
  for await (const held of req) {
    const chunk = Buffer.isBuffer(held) ? held : Buffer.from(held)
    total += chunk.byteLength
    if (total > maxBytes) throw new Refusal(413, 'E_PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const FLOAT = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** A path segment or query value as the input type. Strict: anything ambiguous is refused. */
const parseText = (type: string, raw: string): { ok: true; value: unknown } | { ok: false } => {
  const base = type.endsWith('?') ? type.slice(0, -1) : type
  if (base === 'int') {
    const n = Number(raw)
    return /^-?\d+$/.test(raw) && Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false }
  }
  if (base === 'float') {
    const n = Number(raw)
    return FLOAT.test(raw) && Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
  }
  if (base === 'bool')
    return raw === 'true' || raw === 'false' ? { ok: true, value: raw === 'true' } : { ok: false }
  // Strings, decimals and dates stay text; the field's schema checks their spelling.
  return { ok: true, value: raw }
}

const issue = (
  field: string | null,
  code: string,
  params: Record<string, unknown> = {},
): ValidationIssue => ({
  field,
  code,
  messageKey: `validation.${code}`,
  params,
})

/** The function input this request carries, or a 422 naming every field that is wrong. */
async function inputOf(
  ctx: ServeContext,
  b: HttpBindingMeta,
  url: URL,
  req: IncomingMessage,
  params: RouteParams,
  actor: string | null,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {}
  const issues: ValidationIssue[] = []
  const refused = (name: string): string | null => {
    const held = b.inputs[name]
    if (!held) return 'unknown'
    if (held.from === 'identity') return 'bound'
    if (held.from === 'path') return 'path'
    return null
  }

  for (const [name, held] of Object.entries(b.inputs)) {
    if (held.from !== 'path') continue
    const parsed = parseText(held.type, params[held.placeholder] ?? '')
    if (parsed.ok) input[name] = parsed.value
    else issues.push(issue(name, 'type', { expected: held.type }))
  }

  const identity = Object.entries(b.inputs).filter(([, held]) => held.from === 'identity')
  const scope = identity.some(([, held]) => held.from === 'identity' && held.value !== 'actor')
    ? await ctx.scopeOf(url, req)
    : null
  for (const [name, held] of identity) {
    if (held.from !== 'identity') continue
    const value = held.value === 'actor' ? actor : held.value === 'company' ? scope?.company : scope?.branch
    if (value != null) input[name] = value
  }

  // Query keys: one value each, and only for inputs that read the query string.
  for (const key of new Set(url.searchParams.keys())) {
    const wrong = b.inputs[key]?.from === 'query' ? null : (refused(key) ?? 'unknown')
    if (wrong) {
      issues.push(issue(key, wrong))
      continue
    }
    const values = url.searchParams.getAll(key)
    if (values.length > 1) {
      issues.push(issue(key, 'repeated'))
      continue
    }
    const parsed = parseText(b.inputs[key]!.type, values[0]!)
    if (parsed.ok) input[key] = parsed.value
    else issues.push(issue(key, 'type', { expected: b.inputs[key]!.type }))
  }

  if (BODY_METHODS.has(b.method)) {
    const raw = await readBody(req, b.maxBodyBytes)
    const contentType = req.headers['content-type']
    if ((raw.byteLength || contentType !== undefined) && !isJsonType(contentType))
      throw new Refusal(415, 'E_HTTP_CONTENT_TYPE')
    let body: unknown = {}
    if (raw.byteLength) {
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        throw new FormValidationError([issue(null, 'json')], { code: 'E_HTTP_INVALID_REQUEST' })
      }
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new FormValidationError([issue(null, 'object')], { code: 'E_HTTP_INVALID_REQUEST' })
    for (const [key, value] of Object.entries(body)) {
      const wrong = b.inputs[key]?.from === 'body' ? null : (refused(key) ?? 'unknown')
      if (wrong) issues.push(issue(key, wrong))
      // Exact decimals travel as strings; a JSON number has already been rounded.
      else if (typeof value === 'number' && b.inputs[key]!.type.replace(/\?$/, '') === 'decimal')
        issues.push(issue(key, 'decimal'))
      else input[key] = value
    }
  }

  for (const [name, held] of Object.entries(b.inputs)) {
    if (held.from === 'identity' || input[name] == null || issues.some((i) => i.field === name)) continue
    const violation = validateJson(held.schema, input[name])
    if (violation) issues.push(issue(name, violation.rule, { pointer: violation.pointer }))
  }
  if (issues.length) throw new FormValidationError(issues, { code: 'E_HTTP_INVALID_REQUEST' })
  return input
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Spell an output value the way its contract does, where that loses nothing: a
 * decimal computed as a number becomes its exact text, a Date its ISO instant.
 */
const normalized = (b: HttpBindingMeta, value: unknown): unknown => {
  const row = (held: unknown): unknown => {
    if (!isRecord(held)) return held
    const out: Record<string, unknown> = { ...held }
    for (const [name, type] of Object.entries(b.output)) {
      const base = type.endsWith('?') ? type.slice(0, -1) : type
      const field = out[name]
      if (base === 'decimal' && typeof field === 'number') {
        const parsed = parseDecimal(field)
        if (parsed.ok) out[name] = parsed.value
      } else if (base === 'datetime' && field instanceof Date && Number.isFinite(field.getTime())) {
        out[name] = field.toISOString()
      }
    }
    return out
  }
  return Array.isArray(value) ? value.map(row) : row(value)
}

const newRequestId = (): string => randomUUID()

async function answer(
  ctx: ServeContext,
  path: string,
  b: HttpBindingMeta,
  url: URL,
  req: IncomingMessage,
  params: RouteParams,
): Promise<RouteResult> {
  const requestId = newRequestId()
  const headers: Record<string, string> = {
    'x-request-id': requestId,
    ...(b.auth === 'required' ? { 'cache-control': 'no-store' } : {}),
  }
  try {
    if (req.method !== b.method) throw new Refusal(405, 'E_HTTP_METHOD', { allow: b.method })
    const identity = await ctx.requestIdentityOf(url, req)
    if (b.auth === 'required' && !identity) throw new Refusal(401, 'E_HTTP_UNAUTHENTICATED')
    if (identity?.origin === 'session' && b.method !== 'GET') {
      if (!sameOrigin(url, req)) throw new Refusal(403, 'E_HTTP_CSRF')
      if (BODY_METHODS.has(b.method) && !isJsonType(req.headers['content-type']))
        throw new Refusal(415, 'E_HTTP_CONTENT_TYPE')
    }

    const key = req.headers['idempotency-key']
    if (key !== undefined && b.idempotency === 'none')
      throw new Refusal(400, 'E_HTTP_IDEMPOTENCY_UNSUPPORTED')
    if (key === undefined && b.idempotency === 'required')
      throw new Refusal(428, 'E_HTTP_IDEMPOTENCY_REQUIRED')
    if (key !== undefined && validateJson(IDEMPOTENCY_KEY_SCHEMA, key) !== null)
      throw new FormValidationError([issue('Idempotency-Key', 'idempotencyKey')], {
        code: 'E_HTTP_INVALID_REQUEST',
      })

    const actor = identity?.userId ?? null
    const input = await inputOf(ctx, b, url, req, params, actor)
    const company = key === undefined ? null : ((await ctx.scopeOf(url, req)).company ?? null)
    const value = await ctx.call(b.fn, input, url, req, {
      correlationId: requestId,
      ...(key === undefined
        ? {}
        : {
            idempotencyKey: key as string,
            idempotencyNamespace: `http:${b.operationId}:${company ?? 'none'}:${actor ?? 'anonymous'}`,
          }),
    })

    if (b.result === null) return withHeaders(text('', { status: 204 }), headers)
    const shaped = normalized(b, value)
    const violation = validateJson(b.result, shaped)
    if (violation) {
      // The function broke its own published contract. Where and which rule, never
      // the value: it is the response a client was about to receive.
      ctx.logger.error('http_binding_output', null, {
        operationId: b.operationId,
        requestId,
        route: path,
        pointer: violation.pointer,
        rule: violation.rule,
      })
      return failure(ctx, b, url, req, headers, 500, 'E_INTERNAL', null)
    }
    return withHeaders(json(b.envelope === 'data' ? { data: shaped } : shaped, { status: b.status }), headers)
  } catch (error) {
    if (error instanceof Refusal)
      return failure(ctx, b, url, req, { ...headers, ...error.headers }, error.status, error.code, null)
    if (error instanceof FormValidationError) {
      // Keyed by input name; "" is the JSON pointer of the request as a whole.
      const fields = { ...error.fieldErrors, ...(error.formErrors.length ? { '': error.formErrors } : {}) }
      return failure(ctx, b, url, req, headers, 422, error.code, fields)
    }
    if (error instanceof KetError) {
      const fixed = FIXED[error.code]
      if (fixed && error.code !== 'E_INTERNAL')
        return failure(ctx, b, url, req, headers, fixed.status, error.code, null)
      const declared = b.errors[error.code]
      if (declared) return failure(ctx, b, url, req, headers, declared.status, error.code, null)
    }
    // Undeclared, so not part of the contract: the client learns that something
    // failed, and the server keeps what.
    ctx.logger.error('http_binding_failed', error, { operationId: b.operationId, requestId, route: path })
    return failure(ctx, b, url, req, headers, 500, 'E_INTERNAL', null)
  }
}

function failure(
  ctx: ServeContext,
  b: HttpBindingMeta,
  url: URL,
  req: IncomingMessage,
  headers: Record<string, string>,
  status: number,
  code: string,
  fields: Record<string, ValidationIssue[]> | null,
): RouteResult {
  const declared = b.errors[code]?.messageKey
  let message = FIXED[code]?.message ?? STATUS_CODES[status] ?? 'request refused'
  if (declared) {
    const translate = ctx.translate(ctx.localeOf(url, req))
    if (translate.resolves(declared)) message = translate(declared)
  }
  const error = { code, message, requestId: headers['x-request-id']!, ...(fields ? { fields } : {}) }
  return withHeaders(json({ error }, { status }), headers)
}
