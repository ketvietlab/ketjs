import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['popover', 'popover-trigger', 'popover-panel', 'popover-close'] as const

export type PopoverProps = {
  id: string
  label: string
  trigger: JSXChild
  body: JSXChild
  open: boolean
  openHref: string
  closeHref: string
  closeLabel: string
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
}

export const Popover = (props: PopoverProps): TemplateResult => (
  <span data-ui="popover" data-open={String(props.open)} data-placement={props.placement ?? 'bottom-start'}>
    <a
      data-ui="popover-trigger"
      href={props.open ? props.closeHref : props.openHref}
      aria-haspopup="dialog"
      aria-expanded={String(props.open)}
      aria-controls={`${props.id}-panel`}
    >
      {props.trigger}
    </a>
    {props.open && (
      <aside
        data-ui="popover-panel"
        id={`${props.id}-panel`}
        role="dialog"
        aria-label={props.label}
        tabindex="-1"
      >
        <a data-ui="popover-close" href={props.closeHref} aria-label={props.closeLabel}>
          ×
        </a>
        {props.body}
      </aside>
    )}
  </span>
)
