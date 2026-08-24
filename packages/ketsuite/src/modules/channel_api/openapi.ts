import { type Manifest, SESSION_COOKIE } from '@ketvietlab/ketjs'
import { type ChannelAuth, type ChannelProfile, demands, resolves } from './core.ts'

/**
 * Each profile presents its credential differently, and a document naming the
 * wrong one produces a generated client that cannot authenticate at all. A
 * customer arrives with a bearer token or the storefront cookie; a staff caller
 * only ever arrives with the verified session cookie, which is why there is no
 * bearer scheme on that side to offer.
 */
const SCHEMES: Record<ChannelProfile, Record<string, unknown>> = {
  customer: {
    bearer: { type: 'http', scheme: 'bearer' },
    customerCookie: { type: 'apiKey', in: 'cookie', name: 'ket_customer_session' },
  },
  staff: { staffCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
  pos: {},
  integration: {},
}

const securityFor = (profile: ChannelProfile, auth: ChannelAuth): unknown[] => {
  if (!resolves(auth)) return []
  const offered = Object.keys(SCHEMES[profile]).map((name) => ({ [name]: [] }))
  return demands(auth) ? offered : [{}, ...offered]
}

const operationPath = (path: string, profile: ChannelProfile): string =>
  path.slice(`/api/${profile}/v1`.length) || '/'

export const openApiDocument = (manifest: Manifest, profile: ChannelProfile) => {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const contract = entry.contract
    if (contract?.profile !== profile) continue
    const parameters = [
      ...Object.entries(
        (contract.request?.params?.properties as Record<string, unknown> | undefined) ?? {},
      ).map(([name, schema]) => ({ name, in: 'path', required: true, schema })),
      ...Object.entries(
        (contract.request?.query?.properties as Record<string, unknown> | undefined) ?? {},
      ).map(([name, schema]) => ({ name, in: 'query', required: false, schema })),
    ]
    paths[operationPath(path, profile)] = {
      [contract.method.toLowerCase()]: {
        operationId: contract.operationId,
        ...(contract.summary ? { summary: contract.summary } : {}),
        security: securityFor(profile, (contract.auth ?? 'public') as ChannelAuth),
        ...(parameters.length ? { parameters } : {}),
        ...(contract.request?.body
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: contract.request.body } },
              },
            }
          : {}),
        responses: Object.fromEntries(
          Object.entries(contract.responses).map(([status, schema]) => [
            status,
            {
              description: status.startsWith('2') ? 'Success' : 'Error',
              content: { 'application/json': { schema } },
            },
          ]),
        ),
        'x-ket-capability': contract.capability ?? null,
        'x-ket-auth': contract.auth ?? 'public',
        'x-ket-idempotent': contract.idempotent === true,
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: `KetSuite ${profile} API`, version: '1.0.0' },
    servers: [{ url: `/api/${profile}/v1` }],
    paths,
    components: { securitySchemes: SCHEMES[profile] },
  }
}
