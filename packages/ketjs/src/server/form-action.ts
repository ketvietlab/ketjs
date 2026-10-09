import { formIssuePath, validateForm, validationIssue } from '@ketvietlab/ketjs-view'
import type { FormContract, FormOutcome, FormValues } from '@ketvietlab/ketjs-view'
import type { Ctx, FnSpec } from '../types.ts'

/** Internal unwind: a normal domain refusal must roll back earlier writes as well. */
export class FormActionRefusal extends Error {
  readonly outcome: Exclude<FormOutcome, { status: 'committed' }>
  constructor(outcome: Exclude<FormOutcome, { status: 'committed' }>) {
    super(`form action ${outcome.status}`)
    this.outcome = outcome
  }
}

export type FormActionInput<T extends FormValues> = {
  recordId: string
  expectedRevision: string | null
  values: T
}

/** Declare an ordinary function with the shared form contract and atomic receipt semantics. */
export function defineFormAction<T extends FormValues, R = unknown>(
  contract: FormContract<T>,
  spec: {
    effects: string[]
    exposure?: 'http' | 'internal'
    handler: (ctx: Ctx, input: FormActionInput<T>) => FormOutcome<T, R> | Promise<FormOutcome<T, R>>
  },
): FnSpec {
  return {
    input: { contractId: 'text', recordId: 'id', expectedRevision: 'text?', values: 'json' },
    output: { status: 'text', accepted: 'json?', revision: 'text?', value: 'json?', issues: 'json?' },
    returns: 'one',
    effects: spec.effects,
    exposure: spec.exposure,
    idempotent: true,
    transactional: true,
    dryRun: false,
    handler: async (ctx, args) => {
      if (args.contractId !== contract.id || !Object.hasOwn(args, 'expectedRevision'))
        throw new FormActionRefusal({
          status: 'invalid',
          issues: [validationIssue(null, 'contract', 'validation.contract')],
        })
      const parsed = validateForm(contract.schema, args.values as FormValues)
      if (!parsed.valid)
        throw new FormActionRefusal({
          status: 'invalid',
          issues: parsed.issues.map((issue) => ({
            ...issue,
            ...(issue.field && !issue.path
              ? { path: formIssuePath(contract, args.values as FormValues, issue.field) }
              : {}),
          })),
        })
      const outcome = await spec.handler(ctx, {
        recordId: String(args.recordId),
        expectedRevision: args.expectedRevision == null ? null : String(args.expectedRevision),
        values: parsed.values,
      })
      if (outcome.status !== 'committed') {
        if (outcome.status !== 'invalid' && outcome.status !== 'conflict')
          throw new TypeError('invalid form outcome')
        throw new FormActionRefusal({
          ...outcome,
          issues: outcome.issues.map((issue) => ({
            ...issue,
            ...(issue.field && !issue.path
              ? { path: formIssuePath(contract, parsed.values, issue.field) }
              : {}),
          })),
        })
      }
      const accepted = validateForm(contract.schema, outcome.accepted)
      if (!accepted.valid || typeof outcome.revision !== 'string' || !outcome.revision)
        throw new TypeError('a committed form action must return valid accepted values and a revision')
      return { ...outcome, accepted: accepted.values }
    },
  }
}
