import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['action', 'action-leading', 'action-label', 'action-spinner', 'action-group'] as const

export type ActionVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'
export type ActionSize = 'compact' | 'default' | 'prominent'

type ActionBase = {
  label: string
  variant?: ActionVariant
  size?: ActionSize
  leading?: JSXChild
  disabled?: boolean
  loading?: boolean
  describedBy?: string | null
}

export type ButtonProps = ActionBase & {
  type?: 'button' | 'submit' | 'reset'
  name?: string | null
  value?: string | null
  form?: string | null
}

export type LinkButtonProps = ActionBase & { href: string }

const ActionContent = (props: ActionBase): TemplateResult => (
  <>
    {props.loading === true && <span data-ui="action-spinner" aria-hidden="true" />}
    {props.loading !== true && props.leading !== undefined && (
      <span data-ui="action-leading" aria-hidden="true">
        {props.leading}
      </span>
    )}
    <span data-ui="action-label">{props.label}</span>
  </>
)

export const Button = (props: ButtonProps): TemplateResult => (
  <button
    data-ui="action"
    data-variant={props.variant ?? 'secondary'}
    data-size={props.size ?? 'default'}
    type={props.type ?? 'button'}
    name={props.name ?? null}
    value={props.value ?? null}
    form={props.form ?? null}
    disabled={props.disabled === true || props.loading === true}
    aria-busy={props.loading === true ? 'true' : null}
    aria-describedby={props.describedBy ?? null}
  >
    <ActionContent {...props} />
  </button>
)

export const LinkButton = (props: LinkButtonProps): TemplateResult =>
  props.disabled ? (
    <button
      data-ui="action"
      data-variant={props.variant ?? 'secondary'}
      data-size={props.size ?? 'default'}
      type="button"
      disabled
      aria-describedby={props.describedBy ?? null}
    >
      <ActionContent {...props} />
    </button>
  ) : (
    <a
      data-ui="action"
      data-variant={props.variant ?? 'secondary'}
      data-size={props.size ?? 'default'}
      href={props.href}
      aria-describedby={props.describedBy ?? null}
    >
      <ActionContent {...props} />
    </a>
  )

export const ActionGroup = (props: {
  actions: readonly JSXChild[]
  label?: string | null
}): TemplateResult => (
  <div data-ui="action-group" role="group" aria-label={props.label ?? null}>
    {each(
      props.actions,
      (_, index) => index,
      (action) => (
        <>{action}</>
      ),
    )}
  </div>
)
