import { defineJob } from '@ketvietlab/ketjs'
import { ACCESS_POLICY_EFFECTS, reconcileAccessPolicies } from './access-policy.ts'

export const policyJobs = {
  reconcileAccessPolicies: defineJob({
    input: {},
    crossCompany: true,
    idempotent: true,
    schedule: { every: '1m' },
    effects: ACCESS_POLICY_EFFECTS,
    handler: async (ctx) => {
      await reconcileAccessPolicies(ctx)
    },
  }),
}
