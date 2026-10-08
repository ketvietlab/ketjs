// OpenAPI from a composed manifest.
//
// It reads only what composition checked — routes that actually shipped, with their
// contracts — so a module that is absent or disabled leaves no stale operation.
// Nothing is imported from a feature module and nothing is served: where the
// document is published, and which renderer reads it, stay the application's call.

import { KetError } from './errors.ts'
import type { HttpRouteContract, JsonSchema, Manifest } from '../types.ts'

export type HttpContractEntry = { path: string; contract: HttpRouteContract }

/** Every route contract of one profile, bindings and handwritten alike, sorted by path. */
export function httpContracts(manifest: Manifest, o: { profile: string }): HttpContractEntry[] {
  return Object.entries(manifest.routes)
    .filter(([, route]) => route.contract?.profile === o.profile)
    .map(([path, route]) => ({ path, contract: route.contract as HttpRouteContract }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export type HttpOpenApiOptions = {
  profile: string
  info: { title: string; version: string; description?: string }
  servers?: { url: string; description?: string }[]
  /** OpenAPI security scheme objects, by name. */
  securitySchemes?: Record<string, Record<string, unknown>>
  /** Applied to every operation that is not public; required when the profile has one. */
  security?: Record<string, string[]>[]
}

const REASONS: Readonly<Record<string, string>> = {
  '200': 'OK',
  '201': 'Created',
  '204': 'No Content',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '409': 'Conflict',
  '413': 'Content Too Large',
  '415': 'Unsupported Media Type',
  '422': 'Unprocessable Content',
  '428': 'Precondition Required',
  '500': 'Internal Server Error',
}

const refuse = (message: string, hint: string): KetError =>
  new KetError({ code: 'E_OPENAPI_SECURITY', module: 'openapi', message, hint })

const parameters = (schema: JsonSchema | undefined, location: 'path' | 'query' | 'header') => {
  const properties = (schema?.['properties'] ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema?.['required'] ?? []) as string[])
  return Object.entries(properties).map(([name, held]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: held,
  }))
}

const response = (status: string, schema: JsonSchema) =>
  status === '204'
    ? { description: REASONS[status] }
    : { description: REASONS[status] ?? `Status ${status}`, content: { 'application/json': { schema } } }

/**
 * An OpenAPI 3.1 document for one profile. Schemas stay inline, and the same
 * manifest always yields the same document, so it can be committed and diffed.
 */
export function httpOpenApiDocument(manifest: Manifest, o: HttpOpenApiOptions): Record<string, unknown> {
  const schemes = o.securitySchemes ?? {}
  const known = (name: string) => Object.hasOwn(schemes, name)
  for (const requirement of o.security ?? [])
    for (const name of Object.keys(requirement))
      if (!known(name))
        throw refuse(
          `security names scheme "${name}", which securitySchemes does not define`,
          'define it in securitySchemes',
        )

  const paths: Record<string, Record<string, unknown>> = {}
  for (const { path, contract } of httpContracts(manifest, o)) {
    for (const name of contract.credentials ?? [])
      if (!known(name))
        throw refuse(
          `operation "${contract.operationId}" documents credential "${name}", which securitySchemes does not define`,
          'define it in securitySchemes',
        )
    let security: Record<string, string[]>[] = []
    if (contract.auth !== 'public') {
      if (!o.security?.length)
        throw refuse(
          `operation "${contract.operationId}" at "${path}" requires authentication, but no security was given`,
          'pass security: [{ <scheme>: [] }] naming a scheme from securitySchemes',
        )
      security = [...o.security, ...(contract.credentials ?? []).map((name) => ({ [name]: [] }))]
    }
    const request = contract.request ?? {}
    const listed = [
      ...parameters(request.params, 'path'),
      ...parameters(request.query, 'query'),
      ...parameters(request.headers, 'header'),
    ]
    const body = request.body
    const statuses = Object.keys(contract.responses).sort()
    paths[path] = {
      [contract.method.toLowerCase()]: {
        operationId: contract.operationId,
        ...(contract.summary ? { summary: contract.summary } : {}),
        ...(listed.length ? { parameters: listed } : {}),
        ...(body
          ? {
              requestBody: {
                required: Array.isArray(body['required']) && body['required'].length > 0,
                content: { 'application/json': { schema: body } },
              },
            }
          : {}),
        responses: Object.fromEntries(
          statuses.map((status) => [status, response(status, contract.responses[status]!)]),
        ),
        security,
      },
    }
  }

  // A copy: the document is the caller's to edit, and the manifest is not.
  return structuredClone({
    openapi: '3.1.0',
    info: o.info,
    ...(o.servers ? { servers: o.servers } : {}),
    paths,
    ...(Object.keys(schemes).length ? { components: { securitySchemes: schemes } } : {}),
  })
}
