import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['spinner', 'visually-hidden'] as const

export const Spinner = (props: { label: string; size?: 'small' | 'default' | 'large' }): TemplateResult => (
  <span data-ui="spinner" data-size={props.size ?? 'default'} role="status">
    <span data-ui="visually-hidden">{props.label}</span>
  </span>
)
