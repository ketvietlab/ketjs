import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type FieldIssue = { path: string; message: string }

export const issueFor = (issues: readonly FieldIssue[] | undefined, name: string): string | null =>
  issues?.find((issue) => issue.path === name)?.message ?? null

export type FieldFrameProps = {
  id: string
  label: string
  control: JSXChild
  help?: string | null
  error?: string | null
  required?: boolean
  span?: 'half' | 'full'
  kind: string
}

export const FieldFrame = (props: FieldFrameProps): TemplateResult => {
  const helpId = props.help ? `${props.id}-help` : null
  const errorId = props.error ? `${props.id}-error` : null
  return (
    <div
      data-ui="field"
      data-kind={props.kind}
      data-span={props.span ?? 'half'}
      data-invalid={String(!!props.error)}
    >
      <label data-ui="field-label" for={props.id}>
        {props.label}
        {props.required && (
          <span data-ui="field-required" aria-hidden="true">
            {' *'}
          </span>
        )}
      </label>
      {props.control}
      {!!props.help && (
        <small data-ui="field-help" id={helpId ?? undefined}>
          {props.help}
        </small>
      )}
      {!!props.error && (
        <small data-ui="field-error" id={errorId ?? undefined}>
          {props.error}
        </small>
      )}
    </div>
  )
}

export const describedBy = (id: string, help?: string | null, error?: string | null): string | null =>
  [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || null
