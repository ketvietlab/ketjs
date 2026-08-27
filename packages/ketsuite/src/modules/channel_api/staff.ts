// The staff profile's identity, and the two routes that prove it works.
//
// Staff identity is the verified session and nothing else. There is no realm
// header, no tenant hint in the body, no company in the query — the session
// carries which company this caller writes to and which ones they may read, and
// the framework re-resolves that from live rows on every request. Revoking a
// membership or archiving a company therefore takes effect on the next call
// rather than whenever a credential happens to expire, and a caller cannot name
// a company they were not already granted.

import { SESSION_COOKIE, type Route, type ServeContext } from '@ketvietlab/ketjs'
import {
  channelError,
  csrfTokenFor,
  defineChannelRoute,
  registerChannelIdentityPresentation,
  routesOf,
  stableHash,
} from './core.ts'
import { CHANNEL_API_VERSION } from './core.ts'
import type { StaffIdentity } from './core.ts'

type Req = Parameters<Route>[1]

const envelope = { type: 'object', properties: { data: {}, error: {}, meta: { type: 'object' } } }

export const staffIdentity = async (ctx: ServeContext, url: URL, req: Req): Promise<StaffIdentity | null> => {
  const sessions = await ctx.sessionsOf(url, req)
  const record = await sessions?.of(req)
  if (!record) return null
  return {
    userId: record.userId,
    companyId: record.company,
    branchId: record.branch,
    companies: record.companies,
    branches: record.branches,
    securityVersion: record.securityVersion,
    sessionId: record.id,
    presentation: 'cookie',
  }
}

registerChannelIdentityPresentation('staff', {
  presentation: 'cookie',
  presented: (req) =>
    String(req.headers.cookie ?? '')
      .split(';')
      .some((part) => part.trim().split('=', 1)[0] === SESSION_COOKIE),
  resolve: staffIdentity,
})

export const staffRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'bootstrap',
    operationId: 'staff.bootstrap',
    summary: 'Resolve the signed-in operator, their company scope and live capabilities.',
    auth: 'required',
    responses: { '200': envelope },
    handler: async (ctx, _url, req, _params, request) => {
      const identity = request.identity!
      const live = await ctx.live(req)
      // What this deployment serves this tenant, not what it ships. An operator
      // has no more business than a shopper does learning which other verticals
      // exist on the box.
      const grouped = new Map<string, Set<string>>()
      for (const entry of Object.values(live.routes)) {
        const contract = entry.contract
        if (contract?.profile !== 'staff' || !contract.capability) continue
        const actions = grouped.get(contract.capability.key) ?? new Set<string>()
        actions.add(contract.capability.action)
        grouped.set(contract.capability.key, actions)
      }
      const capabilities = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, actions]) => ({ key, actions: [...actions].sort() }))
      return {
        data: {
          contractVersion: CHANNEL_API_VERSION,
          user: { id: identity.userId },
          /**
           * The token every mutation on this session has to echo back.
           *
           * A staff session is a cookie, so it rides along on a cross-site
           * request whether the operator meant it or not, and the facade asks
           * unsafe methods to prove intent. The customer profile hands this over
           * at sign-in; staff sign in through the framework, which knows nothing
           * about this channel — so bootstrap is where it is handed over, and a
           * client that has not bootstrapped cannot mutate.
           */
          csrfToken: identity.presentation === 'cookie' ? csrfTokenFor(identity.sessionId) : null,
          // The scope the session settled on, so a client can label what it is
          // looking at. It is reported, never accepted.
          scope: {
            companyId: identity.companyId,
            branchId: identity.branchId,
            companies: [...identity.companies],
            branches: identity.branches ? [...identity.branches] : null,
          },
          capabilities,
          capabilityRevision: stableHash(capabilities),
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'me',
    operationId: 'staff.me',
    summary: 'The operator this session belongs to.',
    auth: 'required',
    capability: { key: 'channel_api.staff_account', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      // Through ctx.call, not callUnchecked: a staff route answers within the
      // permissions this session actually has, and the framework is what knows
      // them. Reaching past that check is how a channel becomes a way around
      // the roles every other surface obeys.
      const user = (await ctx.call('user.getUser', { id: identity.userId }, url, req)) as {
        id?: string
        name?: string
        login?: string
      } | null
      if (!user?.id)
        return {
          status: 401,
          error: channelError(ctx, url, req, 'channel_api.unauthenticated', {
            messageKey: 'channel_api.error.unauthenticated',
          }),
        }
      return { data: { user: { id: user.id, name: user.name ?? null, login: user.login ?? null } } }
    },
  }),
)
