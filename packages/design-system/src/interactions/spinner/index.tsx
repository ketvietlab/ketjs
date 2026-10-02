import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['spinner', 'visually-hidden'] as const

export type SpinnerProps = { label: string; size?: 'small' | 'default' | 'large'; decorative?: boolean }

export const Spinner = (props: SpinnerProps): TemplateResult => (
  <span
    data-ui="spinner"
    data-size={props.size ?? 'default'}
    role={props.decorative ? undefined : 'status'}
    aria-hidden={props.decorative ? 'true' : null}
  >
    {!props.decorative && <span data-ui="visually-hidden">{props.label}</span>}
  </span>
)
