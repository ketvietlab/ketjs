import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['tooltip', 'tooltip-trigger', 'tooltip-content'] as const

export const Tooltip = (props: {
  id: string
  text: string
  trigger: JSXChild | ((association: { describedBy: string }) => JSXChild)
  placement?: 'top' | 'right' | 'bottom' | 'left'
}): TemplateResult => (
  <span data-ui="tooltip" data-placement={props.placement ?? 'top'}>
    <span data-ui="tooltip-trigger">
      {typeof props.trigger === 'function' ? props.trigger({ describedBy: props.id }) : props.trigger}
    </span>
    <span data-ui="tooltip-content" id={props.id} role="tooltip">
      {props.text}
    </span>
  </span>
)
