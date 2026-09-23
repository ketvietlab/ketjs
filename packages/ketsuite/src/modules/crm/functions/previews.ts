import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { ensureCase } from './shared.ts'

export const previewFunctions: Record<string, FnSpec> = {
  'enrichment.preview': defineFn({
    input: { caseId: 'id' },
    output: { ok: 'bool', code: 'text', errors: 'json?' },
    effects: ['read:crm.Case'],
    handler: async (ctx, args) => ({
      ok: false,
      code: (await ensureCase(ctx, args.caseId)) ? 'provider_not_configured' : 'case_not_found',
    }),
  }),

  'mining.preview': defineFn({
    input: { country: 'text?', industry: 'text?' },
    output: { ok: 'bool', code: 'text' },
    effects: [],
    handler: () => ({ ok: false, code: 'provider_not_configured' }),
  }),
}
