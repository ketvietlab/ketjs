import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Text } from '../status/index.tsx'

export type FieldFrameProps = {
  id: string
  label: string
  size?: 'default' | 'large'
  control: JSXChild
  help?: string | null
  error?: string | null
  required?: boolean
  labelHidden?: boolean
  selectionHidden?: boolean
  span?: 'half' | 'full'
  kind: string
  group?: boolean
}

export const describedBy = (id: string, help?: string | null, error?: string | null): string | null =>
  [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || null

export const FieldMessages = (props: Pick<FieldFrameProps, 'id' | 'help' | 'error'>): TemplateResult => (
  <>
    {!!props.help && (
      <small data-ui="field-help" id={`${props.id}-help`}>
        <Text>{props.help}</Text>
      </small>
    )}
    {!!props.error && (
      <small data-ui="field-error" id={`${props.id}-error`}>
        <Text>{props.error}</Text>
      </small>
    )}
  </>
)

/** Owns label/help/error association for native, choice and enhanced controls. */
export const FieldFrame = (props: FieldFrameProps): TemplateResult => {
  const Label = props.group ? 'span' : 'label'
  return (
    <div
      data-ui="field"
      data-kind={props.kind}
      data-size={props.size ?? null}
      data-span={props.span ?? 'half'}
      data-label-hidden={props.labelHidden ? 'true' : null}
      data-selection-hidden={props.selectionHidden ? 'true' : null}
      data-invalid={String(!!props.error)}
    >
      <Label
        data-ui="field-label"
        id={props.group ? `${props.id}-label` : undefined}
        for={props.group ? null : props.id}
      >
        <Text>{props.label}</Text>
        {props.required && (
          <span data-ui="field-required" aria-hidden="true">
            {' *'}
          </span>
        )}
      </Label>
      {props.control}
      <FieldMessages {...props} />
    </div>
  )
}
