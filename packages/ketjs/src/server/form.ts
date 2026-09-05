import { validateForm, validationProblem } from '@ketvietlab/ketjs-view'
import type {
  FormSchema,
  FormValidationProblem,
  FormValidationResult,
  FormValues,
  ValidationIssue,
} from '@ketvietlab/ketjs-view'
import { KetError } from '../kernel/errors.ts'
import { json } from './respond.ts'
import type { RouteResult } from './respond.ts'

type ValidationSource = readonly ValidationIssue[] | Pick<FormValidationResult, 'issues'>

export class FormValidationError extends KetError {
  readonly issues: ValidationIssue[]
  readonly fieldErrors: Record<string, ValidationIssue[]>
  readonly formErrors: ValidationIssue[]

  constructor(
    source: ValidationSource,
    options: {
      code?: string
      message?: string
      hint?: string | null
      module?: string | null
    } = {},
  ) {
    const problem = validationProblem(source, options)
    super({
      code: problem.code,
      message: problem.message,
      hint: options.hint,
      module: options.module,
    })
    this.name = 'FormValidationError'
    this.issues = problem.issues
    this.fieldErrors = problem.fieldErrors
    this.formErrors = problem.formErrors
  }

  override toJSON(): ReturnType<KetError['toJSON']> & FormValidationProblem {
    return {
      ...super.toJSON(),
      ok: false,
      issues: this.issues,
      fieldErrors: this.fieldErrors,
      formErrors: this.formErrors,
    }
  }
}

/** Validate untrusted form values and throw a structured error suitable for an HTTP 422 response. */
export function assertForm<TValues extends FormValues = FormValues>(
  schema: FormSchema<TValues>,
  input: Readonly<FormValues>,
): TValues {
  const result = validateForm(schema, input)
  if (!result.valid) throw new FormValidationError(result)
  return result.values
}

/** Build the standard non-throwing HTTP response for a route that re-renders or returns JSON itself. */
export const invalidForm = (
  source: ValidationSource,
  options: { code?: string; message?: string } = {},
): RouteResult => json(validationProblem(source, options), { status: 422 })

/** Convert legacy `{ field, message }` changeset errors into the shared form issue contract. */
export const issuesFromFieldErrors = (
  errors: readonly { field: string; message: string }[],
  options: { code?: string; messageKey?: string } = {},
): ValidationIssue[] =>
  errors.map((error) => ({
    field: error.field,
    code: options.code ?? 'invalid',
    messageKey: options.messageKey ?? 'validation.invalid',
    params: { message: error.message },
  }))
