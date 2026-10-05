import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { ensureCrmDefaults } from '../operations.ts'
import { defaultEffects, command } from './shared.ts'

const scopeMarker = (scope: 'team' | 'company'): FnSpec =>
  defineFn({
    input: {},
    output: { ok: 'bool', scope: 'text' },
    effects: [],
    handler: () => ({ ok: true, scope }),
  })

export const accessFunctions: Record<string, FnSpec> = {
  'bootstrap.defaults': defineFn({
    input: { idempotencyKey: 'text' },
    output: { ok: 'bool' },
    effects: [...defaultEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      await ensureCrmDefaults(ctx)
      return { ok: true }
    },
  }),

  /**
   * Holding one of these in a role is what widens record access — see
   * `caseAudience`. They do nothing when called; they exist to be granted, so a
   * role screen shows "sees the whole company" beside everything else the role
   * may do instead of keeping it somewhere a role screen cannot see.
   */
  'scope.team': scopeMarker('team'),
  'scope.company': scopeMarker('company'),
}
