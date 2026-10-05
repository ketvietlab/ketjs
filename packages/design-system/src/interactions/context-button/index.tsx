import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Badge, Text } from '../../primitives/status/index.tsx'

export const HOOKS = ['context-button', 'context-button-leading', 'context-button-copy'] as const

export type ContextButtonProps = {
  id?: string
  label: string
  description?: string
  leading?: JSXChild
  count?: number
  pressed?: boolean
  disabled?: boolean
  name?: string
  value?: string
}

/** Selects a workspace context with a second line, rather than an ordinary one-line command. */
export const ContextButton = (props: ContextButtonProps): TemplateResult => (
  <button
    data-ui="context-button"
    id={props.id}
    type="button"
    name={props.name}
    value={props.value}
    aria-pressed={props.pressed === undefined ? null : String(props.pressed)}
    disabled={props.disabled === true}
  >
    {props.leading !== undefined && (
      <span data-ui="context-button-leading" aria-hidden="true">
        {props.leading}
      </span>
    )}
    <span data-ui="context-button-copy">
      <Text fontWeight="medium">{props.label}</Text>
      {!!props.description && (
        <Text variant="bodySm" tone="muted">
          {props.description}
        </Text>
      )}
    </span>
    {!!props.count && <Badge label={String(props.count)} tone="info" size="small" />}
  </button>
)
