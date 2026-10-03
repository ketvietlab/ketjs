// Assembly only — each concern lives in its own file.

import { defineModule } from '@ketvietlab/ketjs'
import { policyJobs } from './policy-jobs.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions as accountFunctions } from './functions/index.ts'
import { accessDenialFunctions } from './access-denial.ts'
import { accessPolicyFunctions } from './access-policy.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

const functions: Record<string, FnSpec> = {}
for (const group of [accountFunctions, accessPolicyFunctions, accessDenialFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate user function: ${key}`)
    functions[key] = spec
  }
}

export default defineModule({
  name: 'user',
  version: '0.1.0',
  depends: ['partner', 'company'],
  title: 'Người dùng',
  summary: 'Tài khoản đăng nhập và những công ty mỗi tài khoản được vào.',
  category: 'Hệ thống',
  // Removing the accounts would remove every way back in.
  models,
  jobs: policyJobs,
  relations,
  functions,
  messages,
  routes,
  joints: {
    'auth.mail': {
      props: { userId: 'id', kind: 'text', token: 'text', expiresAt: 'datetime' },
    },
  },
})

export { hashPassword, verifyPassword, needsRehash } from './password.ts'
export { routes } from './routes.ts'
export { loginScreen } from './login.ts'
export { legacyPermissionCatalogue, legacyPresetFunctions, permittedFor } from './roles.ts'
export type { LegacyPermissionCatalogueEntry, LegacyPermissionTask } from './roles.ts'
export {
  reserveUserEmail,
  createInternalUserWithAccess,
  USER_ACCESS_EFFECTS,
  addSelectedRoles,
  assertAssignableRoles,
  checkUserEmail,
  authorizationTransaction,
  abortAuthorization,
  advanceAuthorizationRevision,
  recordAuthorizationAudit,
  effectiveFunctionKeys,
  normalizeAssignmentScope,
  resolveEffectivePermissions,
} from './authorization.ts'
export type {
  AssignmentScope,
  EffectiveAccess,
  EffectivePermission,
  EffectivePermissionPath,
} from './authorization.ts'
export { resolveUserSession } from './session-context.ts'

export type { InternalUserInput } from './authorization.ts'
