// HTTP bindings: one server function published at one HTTP operation.
//
// Composition derives everything a client relies on — where each input comes from,
// the request and response schemas, the statuses — from the function's own
// signature, so the published contract and the running route read one record and
// cannot drift apart. This file is pure: it decides and describes. The route in
// server/http-binding.ts answers requests from what was decided here.

import { DECIMAL_MAX_CHARS, PLAIN_DECIMAL } from '../data/changeset.ts'
import { mutates } from './effects.ts'
import { isDefectError } from './errors.ts'
import type { Diagnostics } from './errors.ts'
import { schemaProblem, validateJson } from './json-schema-subset.ts'
import { parseRoutePattern } from './routes.ts'
import { parseType } from './types.ts'
import type {
  FieldBase,
  FnReturns,
  HttpBindingInput,
  HttpBindingMeta,
  HttpBindingSpec,
  HttpMethod,
  HttpRouteContract,
  JsonSchema,
  KetModule,
  Manifest,
  ParsedType,
} from '../types.ts'

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
/** Methods whose inputs travel in a JSON body; the others read the query string. */
export const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH'])
export const FN_RETURNS: ReadonlySet<string> = new Set(['one', 'optional', 'many', 'none'])
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
/** 1–255 visible ASCII characters: what a client can put in a header without escaping it. */
export const IDEMPOTENCY_KEY_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 255,
  pattern: '^[\\x21-\\x7E]+$',
}

// Scalars a URL can carry as one segment or one query value. json cannot.
const PARAM_TYPES: ReadonlySet<string> = new Set([
  'id',
  'text',
  'ref',
  'int',
  'float',
  'decimal',
  'bool',
  'date',
  'datetime',
])
// What an identity value is: an id, never a number or a document.
const BIND_TYPES: ReadonlySet<string> = new Set(['id', 'text', 'ref'])

// Codes whose status the framework fixes. A module that remapped them would make
// one failure mean two things depending on the route.
const RESERVED_ERRORS: ReadonlySet<string> = new Set([
  'E_INTERNAL',
  'E_INVALID_INPUT',
  'E_FN_NOT_PERMITTED',
  'E_NOT_FOUND',
  'E_IDEMPOTENCY_CONFLICT',
  'E_IDEMPOTENCY_IN_FLIGHT',
  'E_PAYLOAD_TOO_LARGE',
])

// A handler only `httpRoutes()` made, remembered with the one path it serves. A route
// that carries a binding with any other handler is forged: it would publish a
// contract its handler never promised to keep.
const bindingHandlers = new WeakMap<object, string>()

export function markBindingHandler<T extends object>(handler: T, path: string): T {
  bindingHandlers.set(handler, path)
  return handler
}

export const bindingHandlerPath = (handler: unknown): string | null =>
  typeof handler === 'function' ? (bindingHandlers.get(handler) ?? null) : null

/** The JSON Schema of one scalar, as a binding publishes it. */
export function scalarSchema(base: FieldBase, side: 'input' | 'output'): JsonSchema {
  switch (base) {
    case 'int':
      return { type: 'integer' }
    case 'float':
      return { type: 'number' }
    // A string, because a JSON number cannot carry an exact decimal across the wire.
    case 'decimal':
      return { type: 'string', pattern: PLAIN_DECIMAL.source, maxLength: DECIMAL_MAX_CHARS }
    case 'bool':
      return { type: 'boolean' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'datetime':
      return { type: 'string', format: 'date-time' }
    // The runtime accepts an object or a list for json input and promises nothing about output.
    case 'json':
      return side === 'input' ? { type: ['object', 'array'] } : {}
    default:
      return { type: 'string' }
  }
}

/** The same schema admitting null: what `T?` means for a body field and an output field. */
export function nullable(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema }
  if (out['type'] !== undefined) {
    const types = Array.isArray(out['type']) ? out['type'] : [out['type']]
    if (!types.includes('null')) out['type'] = [...types, 'null']
  }
  if (Array.isArray(out['enum']) && !out['enum'].includes(null)) out['enum'] = [...out['enum'], null]
  if (Object.hasOwn(out, 'const') && out['const'] !== null) {
    out['enum'] = [out['const'], null]
    delete out['const']
  }
  return out
}

export const objectSchema = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})

/** The body of every error a binding answers with. */
export const errorResponseSchema = (): JsonSchema =>
  objectSchema(
    {
      error: objectSchema(
        {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
          fields: {
            type: 'object',
            description: 'Validation issues keyed by input name.',
            additionalProperties: {
              type: 'array',
              items: objectSchema(
                {
                  field: { type: ['string', 'null'] },
                  code: { type: 'string' },
                  messageKey: { type: 'string' },
                  params: { type: 'object' },
                },
                ['field', 'code', 'messageKey', 'params'],
              ),
            },
          },
        },
        ['code', 'message', 'requestId'],
      ),
    },
    ['error'],
  )

const ANNOTATIONS = ['title', 'description', 'examples']
const STRING_NARROWING = new Set(['minLength', 'maxLength', 'pattern', 'enum', ...ANNOTATIONS])
const NUMBER_NARROWING = new Set(['minimum', 'maximum', 'enum', ...ANNOTATIONS])
// decimal keeps its own pattern: a second one would replace it, not narrow it.
const NARROWING: Record<Exclude<FieldBase, 'json'>, ReadonlySet<string>> = {
  id: STRING_NARROWING,
  text: STRING_NARROWING,
  ref: STRING_NARROWING,
  date: STRING_NARROWING,
  datetime: STRING_NARROWING,
  decimal: new Set(['minLength', 'maxLength', 'enum', ...ANNOTATIONS]),
  int: NUMBER_NARROWING,
  float: NUMBER_NARROWING,
  bool: new Set(['enum', ...ANNOTATIONS]),
}

type FieldSchema = { schema: JsonSchema } | { problem: string }

/**
 * One field's schema: the type's own, narrowed or annotated by an override. A json
 * field takes any schema from the subset; a scalar can only become stricter, because
 * the function's validation still runs and a wider contract would be a false one.
 */
function fieldSchema(type: ParsedType, override: unknown, side: 'input' | 'output'): FieldSchema {
  const base = scalarSchema(type.base, side)
  if (override === undefined) return { schema: base }
  const problem = schemaProblem(override)
  if (problem) return { problem }
  const declared = override as JsonSchema
  let schema: JsonSchema
  if (type.base === 'json') {
    schema = { ...declared }
    if (side === 'input') {
      const types = declared['type'] === undefined ? null : [declared['type']].flat()
      if (types?.some((t) => t !== 'object' && t !== 'array'))
        return { problem: 'a json input is an object or a list; its type cannot be anything else' }
      if (!types) schema['type'] = ['object', 'array']
    }
  } else {
    const allowed = NARROWING[type.base]
    const wider = Object.keys(declared).find((key) => !allowed.has(key))
    if (wider)
      return {
        problem: `"${wider}" would change a ${type.base} field; a scalar can only be narrowed or annotated with ${[...allowed].join(', ')}`,
      }
    if (
      type.base === 'decimal' &&
      typeof declared['maxLength'] === 'number' &&
      declared['maxLength'] > DECIMAL_MAX_CHARS
    )
      return { problem: `a decimal is at most ${DECIMAL_MAX_CHARS} characters` }
    if (Array.isArray(declared['enum'])) {
      const stray = declared['enum'].findIndex((option) => validateJson(base, option) !== null)
      if (stray >= 0) return { problem: `/enum/${stray} is not a ${type.base}` }
    }
    schema = { ...base, ...declared }
  }
  if (Array.isArray(schema['examples'])) {
    const stray = schema['examples'].findIndex((example) => validateJson(schema, example) !== null)
    if (stray >= 0) return { problem: `/examples/${stray} does not satisfy the schema` }
  }
  return { schema }
}

type Derived = { binding: HttpBindingMeta; contract: HttpRouteContract }

function deriveBinding(
  m: KetModule,
  path: string,
  spec: HttpBindingSpec,
  manifest: Manifest,
  diag: Diagnostics,
): Derived | null {
  let ok = true
  const report = (code: string, message: string, hint?: string): void => {
    ok = false
    diag.add({ code, module: m.name, message: `binding "${spec.method} ${path}" ${message}`, hint })
  }

  if (!HTTP_METHODS.includes(spec.method)) {
    report('E_HTTP_BINDING_METHOD', `uses unsupported method "${String(spec.method)}"`)
    return null
  }
  const fn = manifest.functions[spec.call]
  if (!fn) {
    report('E_HTTP_BINDING_FUNCTION', `calls unknown function "${spec.call}"`, 'name a composed function')
    return null
  }
  if (fn.provision) {
    report(
      'E_HTTP_BINDING_FUNCTION',
      `publishes provision function "${spec.call}"`,
      'provision functions bootstrap credentials and never get an HTTP endpoint',
    )
    return null
  }
  if (fn.by !== m.name && !m.depends.includes(fn.by))
    report(
      'E_HTTP_BINDING_DEPENDENCY',
      `calls "${spec.call}" but "${m.name}" does not depend on "${fn.by}"`,
      `add "${fn.by}" to depends`,
    )
  if (spec.auth !== 'required' && spec.auth !== 'public')
    report('E_HTTP_BINDING_PUBLIC', `has unknown auth "${String(spec.auth)}"`, 'use "required" or "public"')
  if (spec.envelope !== 'data' && spec.envelope !== 'none')
    report(
      'E_HTTP_BINDING_RETURNS',
      `has unknown envelope "${String(spec.envelope)}"`,
      'use "data" or "none"',
    )
  if (spec.auth === 'public' && !fn.anonymous)
    report(
      'E_HTTP_BINDING_PUBLIC',
      `is public but "${spec.call}" is not anonymous`,
      'declare anonymous: true on the function, or require authentication',
    )
  if (spec.method === 'GET' && mutates(fn.effects))
    report(
      'E_HTTP_BINDING_GET_MUTATES',
      `would change state on GET: "${spec.call}" declares ${fn.effects.join(', ')}`,
      'publish a state-changing function with POST, PUT, PATCH or DELETE',
    )

  const types: Record<string, ParsedType> = {}
  for (const [name, declared] of Object.entries(fn.input)) {
    const parsed = parseType(declared)
    if (parsed.ok) types[name] = parsed
    else report('E_HTTP_BINDING_FUNCTION', `cannot read input "${name}": ${parsed.reason}`)
  }

  // --- path: each placeholder reads one required scalar input ---------------
  const inputs: Record<string, HttpBindingInput> = {}
  const placeholders = parseRoutePattern(path).segments.flatMap((s) => (s.kind === 'param' ? [s.name] : []))
  const inputOf = new Map<string, string>()
  for (const [input, placeholder] of Object.entries(spec.params ?? {})) {
    if (!placeholders.includes(placeholder))
      report(
        'E_HTTP_BINDING_PARAM',
        `maps input "${input}" to "{${placeholder}}", which the path does not have`,
      )
    else if (inputOf.has(placeholder)) report('E_HTTP_BINDING_PARAM', `maps two inputs to "{${placeholder}}"`)
    else inputOf.set(placeholder, input)
  }
  for (const placeholder of placeholders) if (!inputOf.has(placeholder)) inputOf.set(placeholder, placeholder)
  for (const [placeholder, input] of inputOf) {
    const t = types[input]
    if (!Object.hasOwn(fn.input, input)) {
      report(
        'E_HTTP_BINDING_PARAM',
        `has placeholder "{${placeholder}}" but "${spec.call}" has no input "${input}"`,
        'rename the placeholder, or map it with params: { <input>: "<placeholder>" }',
      )
    } else if (inputs[input]) {
      report('E_HTTP_BINDING_PARAM', `reads input "${input}" from two path placeholders`)
    } else if (t && (t.optional || !PARAM_TYPES.has(t.base))) {
      report(
        'E_HTTP_BINDING_PARAM',
        `reads input "${input}" (${fn.input[input]}) from the path`,
        'a path segment carries one required scalar',
      )
    } else if (t) {
      inputs[input] = { from: 'path', placeholder, type: fn.input[input]!, schema: {} }
    }
  }

  // --- bind: inputs the identity supplies and the client never does --------
  for (const [input, value] of Object.entries(spec.bind ?? {})) {
    const t = types[input]
    if (!Object.hasOwn(fn.input, input)) report('E_HTTP_BINDING_BIND', `binds unknown input "${input}"`)
    else if (inputs[input])
      report('E_HTTP_BINDING_BIND', `binds input "${input}", which the path already reads`)
    else if (value !== 'actor' && value !== 'company' && value !== 'branch')
      report(
        'E_HTTP_BINDING_BIND',
        `binds "${input}" to unknown value "${String(value)}"`,
        'use actor, company or branch',
      )
    else if (value === 'actor' && spec.auth === 'public')
      report('E_HTTP_BINDING_BIND', `binds "${input}" to the actor of a public route, which may have none`)
    else if (t && !BIND_TYPES.has(t.base))
      report('E_HTTP_BINDING_BIND', `binds "${input}" (${fn.input[input]}) to ${value}, which is an id`)
    else if (t && !t.optional && (value === 'branch' || (value === 'company' && spec.auth === 'public')))
      report(
        'E_HTTP_BINDING_BIND',
        `binds required input "${input}" to ${value}, which a request may not have`,
        `declare it "${fn.input[input]}?"`,
      )
    else if (t) inputs[input] = { from: 'identity', value, type: fn.input[input]! }
  }

  // --- everything else: the query string, or the JSON body ------------------
  const source = BODY_METHODS.has(spec.method) ? 'body' : 'query'
  for (const [input, t] of Object.entries(types)) {
    if (inputs[input]) continue
    if (source === 'query' && !PARAM_TYPES.has(t.base)) {
      report(
        'E_HTTP_BINDING_QUERY_TYPE',
        `would read input "${input}" (${fn.input[input]}) from the query string, which cannot carry it`,
        'publish the function with POST, or give the input a scalar type',
      )
      continue
    }
    inputs[input] = { from: source, type: fn.input[input]!, schema: {} }
  }

  for (const name of Object.keys(spec.schemas?.input ?? {})) {
    if (!Object.hasOwn(fn.input, name)) report('E_HTTP_BINDING_SCHEMA', `describes unknown input "${name}"`)
    else if (inputs[name]?.from === 'identity')
      report('E_HTTP_BINDING_SCHEMA', `describes bound input "${name}", which the client never sends`)
  }
  for (const [name, held] of Object.entries(inputs)) {
    if (held.from === 'identity') continue
    const t = types[name]!
    const field = fieldSchema(t, spec.schemas?.input?.[name], 'input')
    if ('problem' in field) {
      report('E_HTTP_BINDING_SCHEMA', `has an invalid schema for input "${name}": ${field.problem}`)
      continue
    }
    held.schema = held.from === 'body' && t.optional ? nullable(field.schema) : field.schema
  }

  // --- response: how many rows, and what each row is -----------------------
  const hasOutput = Object.keys(fn.output).length > 0
  if (spec.returns !== undefined && !FN_RETURNS.has(spec.returns))
    report('E_HTTP_BINDING_RETURNS', `declares unknown returns "${String(spec.returns)}"`)
  if (fn.returns !== undefined && spec.returns !== undefined && fn.returns !== spec.returns)
    report(
      'E_HTTP_BINDING_RETURNS',
      `declares returns "${spec.returns}" but "${spec.call}" returns "${fn.returns}"`,
    )
  const returns: FnReturns | undefined = fn.returns ?? spec.returns
  const unbounded =
    'declare output fields and returns on the function, or returns: "none" to discard the value'
  if (returns === undefined)
    report(
      'E_HTTP_BINDING_RETURNS',
      hasOutput
        ? `cannot tell whether "${spec.call}" returns one row, a nullable row or a list`
        : `would publish whatever "${spec.call}" returns: it declares no output`,
      hasOutput ? 'declare returns: "one", "optional", "many" or "none" on the function' : unbounded,
    )
  else if (returns !== 'none' && !hasOutput)
    report('E_HTTP_BINDING_RETURNS', `returns "${returns}" but "${spec.call}" declares no output`, unbounded)
  if (spec.status !== undefined && spec.status !== 200 && spec.status !== 201)
    report('E_HTTP_BINDING_RETURNS', `declares status ${String(spec.status)}`, 'use 200 or 201')
  if (returns === 'none' && spec.status !== undefined)
    report('E_HTTP_BINDING_RETURNS', 'returns nothing, which is always 204', 'drop status')

  const output: Record<string, string> = {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [name, declared] of Object.entries(fn.output)) {
    const parsed = parseType(declared)
    if (!parsed.ok) {
      report('E_HTTP_BINDING_SCHEMA', `cannot read output field "${name}": ${parsed.reason}`)
      continue
    }
    const field = fieldSchema(parsed, spec.schemas?.output?.[name], 'output')
    if ('problem' in field) {
      report('E_HTTP_BINDING_SCHEMA', `has an invalid schema for output field "${name}": ${field.problem}`)
      continue
    }
    output[name] = declared
    // `T?` may be absent or null, exactly as projection lets it be.
    properties[name] = parsed.optional ? nullable(field.schema) : field.schema
    if (!parsed.optional) required.push(name)
  }
  for (const name of Object.keys(spec.schemas?.output ?? {}))
    if (!Object.hasOwn(fn.output, name))
      report('E_HTTP_BINDING_SCHEMA', `describes unknown output field "${name}"`)

  // --- idempotency: the runtime's, reached through a header ---------------
  let idempotency: HttpBindingMeta['idempotency'] = 'none'
  if (spec.idempotency !== undefined) {
    if (spec.idempotency !== 'optional' && spec.idempotency !== 'required')
      report('E_HTTP_BINDING_IDEMPOTENCY', `declares unknown idempotency "${String(spec.idempotency)}"`)
    else if (!fn.idempotent)
      report(
        'E_HTTP_BINDING_IDEMPOTENCY',
        `accepts an idempotency key but "${spec.call}" is not idempotent`,
        'declare idempotent: true on the function',
      )
    else if (spec.method === 'GET')
      report('E_HTTP_BINDING_IDEMPOTENCY', 'takes an idempotency key on GET, which is already safe')
    else idempotency = spec.idempotency
  } else if (fn.idempotent && spec.method !== 'GET') idempotency = fn.transactional ? 'required' : 'optional'
  if (fn.transactional && (spec.method === 'GET' || idempotency !== 'required'))
    report(
      'E_HTTP_BINDING_IDEMPOTENCY',
      'transactional functions require a write method and required idempotency',
    )

  const operationId = spec.operationId ?? `${spec.profile}.${spec.call}`
  if (!operationId.startsWith(`${spec.profile}.`) || !/^[A-Za-z0-9_.-]+$/.test(operationId))
    report(
      'E_HTTP_OPERATION_ID',
      `has operationId "${operationId}"`,
      `start it with "${spec.profile}." and use letters, digits, ".", "_" and "-"`,
    )

  const errors: HttpBindingMeta['errors'] = {}
  for (const [code, declared] of Object.entries(spec.errors ?? {})) {
    const status = typeof declared === 'number' ? declared : declared?.status
    const messageKey =
      typeof declared === 'object' && declared !== null ? (declared.messageKey ?? null) : null
    if (
      !/^E_[A-Z0-9_]+$/.test(code) ||
      code.startsWith('E_HTTP_') ||
      RESERVED_ERRORS.has(code) ||
      isDefectError(code)
    )
      report(
        'E_HTTP_BINDING_ERROR',
        `maps error "${code}"`,
        'map business error codes; framework codes keep their status and defects are always 500',
      )
    else if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499)
      report(
        'E_HTTP_BINDING_ERROR',
        `maps "${code}" to ${String(status)}`,
        'a business error is a 4xx status',
      )
    else if (
      messageKey !== null &&
      !Object.values(manifest.messages ?? {}).some((catalog) =>
        Object.hasOwn(catalog, `${m.name}.${messageKey}`),
      )
    )
      report(
        'E_HTTP_BINDING_ERROR',
        `names message "${messageKey}" for "${code}", which no "${m.name}" catalogue has`,
        `add "${messageKey}" to the messages of "${m.name}"`,
      )
    else errors[code] = { status, messageKey: messageKey === null ? null : `${m.name}.${messageKey}` }
  }

  const maxBodyBytes = spec.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1)
    report(
      'E_HTTP_BINDING_PARAM',
      `limits the body to ${String(maxBodyBytes)} bytes`,
      'use a positive integer',
    )

  if (!ok || returns === undefined) return null

  const row = objectSchema(properties, required)
  const result =
    returns === 'one'
      ? row
      : returns === 'optional'
        ? nullable(row)
        : returns === 'many'
          ? { type: 'array', items: row }
          : null
  const status: HttpBindingMeta['status'] = returns === 'none' ? 204 : (spec.status ?? 200)
  const binding: HttpBindingMeta = {
    fn: spec.call,
    operationId,
    method: spec.method,
    auth: spec.auth,
    envelope: spec.envelope,
    status,
    returns,
    inputs,
    output,
    result,
    idempotency,
    errors,
    maxBodyBytes,
  }
  return { binding, contract: contractOf(spec.profile, binding, spec.summary) }
}

/** The transport contract of a composed binding: the same record the route enforces. */
function contractOf(profile: string, b: HttpBindingMeta, summary: string | undefined): HttpRouteContract {
  const fields = (from: 'path' | 'query' | 'body') => {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const [name, input] of Object.entries(b.inputs)) {
      if (input.from !== from) continue
      const key = input.from === 'path' ? input.placeholder : name
      properties[key] = input.schema
      if (input.from === 'path' || !input.type.endsWith('?')) required.push(key)
    }
    return Object.keys(properties).length ? objectSchema(properties, required) : null
  }
  const params = fields('path')
  const query = fields('query')
  const body = fields('body')
  const headers =
    b.idempotency === 'none'
      ? null
      : objectSchema(
          { 'Idempotency-Key': IDEMPOTENCY_KEY_SCHEMA },
          b.idempotency === 'required' ? ['Idempotency-Key'] : [],
        )

  const success =
    b.result === null ? {} : b.envelope === 'data' ? objectSchema({ data: b.result }, ['data']) : b.result
  // Only statuses this operation can answer with.
  const failures = new Set([403, 404, 422, 500])
  if (b.auth === 'required') failures.add(401)
  if (b.idempotency === 'none') failures.add(400)
  else failures.add(409)
  if (b.idempotency === 'required') failures.add(428)
  if (BODY_METHODS.has(b.method)) {
    failures.add(413)
    failures.add(415)
  }
  for (const declared of Object.values(b.errors)) failures.add(declared.status)
  const responses: Record<string, JsonSchema> = { [String(b.status)]: success }
  for (const status of [...failures].sort((x, y) => x - y)) responses[String(status)] = errorResponseSchema()

  return {
    profile,
    method: b.method,
    operationId: b.operationId,
    ...(summary ? { summary } : {}),
    auth: b.auth,
    request: {
      ...(params ? { params } : {}),
      ...(query ? { query } : {}),
      ...(headers ? { headers } : {}),
      ...(body ? { body } : {}),
    },
    responses,
    ...(b.idempotency === 'none' ? {} : { idempotent: true }),
  }
}

/**
 * Composition's HTTP binding pass. Runs after functions and messages exist, against
 * routes the ownership pass already accepted, and writes each binding's meta and
 * derived contract onto its route.
 */
export function composeHttpBindings(
  order: readonly KetModule[],
  manifest: Manifest,
  diag: Diagnostics,
): void {
  for (const m of order) {
    for (const [path, entry] of Object.entries(m.routes)) {
      const handler = typeof entry === 'function' ? entry : entry.handler
      const spec = typeof entry === 'function' ? undefined : entry.binding
      const branded = bindingHandlerPath(handler)
      if (branded === null && spec === undefined) continue
      const composed = manifest.routes[path]
      if (!composed || composed.by !== m.name) continue // ownership already refused it
      if (
        typeof entry === 'function' ||
        !spec ||
        branded !== path ||
        spec.path !== path ||
        entry.contract !== undefined ||
        entry.anonymous !== true
      ) {
        diag.add({
          code: 'E_HTTP_BINDING_FORGED',
          module: m.name,
          message: `route "${path}" carries a function binding that httpRoutes() did not produce`,
          hint: 'build binding routes with httpRoutes(); a binding derives its contract and cannot declare one',
        })
        continue
      }
      const derived = deriveBinding(m, path, spec, manifest, diag)
      if (!derived) continue
      composed.binding = derived.binding
      composed.contract = derived.contract
    }
  }

  // One operation id names one operation in a profile. Two handwritten contracts
  // sharing one were never checked and still are not, so existing deployments compose.
  const holders = new Map<string, { path: string; by: string; binding: boolean }[]>()
  for (const [path, route] of Object.entries(manifest.routes)) {
    if (!route.contract) continue
    const key = `${route.contract.profile}\u0000${route.contract.operationId}`
    holders.set(key, [
      ...(holders.get(key) ?? []),
      { path, by: route.by, binding: route.binding !== undefined },
    ])
  }
  for (const [key, list] of holders) {
    const bound = list.find((held) => held.binding)
    if (list.length < 2 || !bound) continue
    const [profile, operationId] = key.split('\u0000')
    diag.add({
      code: 'E_HTTP_OPERATION_DUPLICATE',
      module: bound.by,
      message: `operation "${operationId}" of profile "${profile}" is published at ${list.map((held) => `"${held.path}"`).join(', ')}`,
      hint: 'give each binding of the same function its own operationId',
    })
  }
}
