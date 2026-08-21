import { callFn } from '@ketvietlab/ketjs'
import type { SessionContext, SessionResolveContext } from '@ketvietlab/ketjs'

/**
 * Rebuild the session's scope from live rows on every request.
 *
 * The cookie is a cache of the user's last selection, never the authority for
 * membership or active state. Revoking a company/branch or archiving either one
 * therefore takes effect on the next request on every pod.
 */
export const resolveUserSession = async ({
  adapter,
  manifest,
  record,
}: SessionResolveContext): Promise<SessionContext | null> => {
  const result = await callFn(
    'user.resolveSessionContext',
    {
      userId: record.userId,
      companyId: record.company,
      branchId: record.branch,
      companies: record.companies,
      branches: record.branches,
      securityVersion: record.securityVersion,
    },
    {
      adapter,
      manifest,
      actor: record.userId,
      scope: {
        company: record.company,
        companies: record.companies,
        branch: record.branch,
        branches: record.branches,
      },
    },
  )
  const value = result.value as { ok?: boolean; context?: SessionContext }
  return value.ok && value.context ? value.context : null
}
