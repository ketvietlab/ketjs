import { Spinner } from '../../interactions/spinner/index.tsx'
import { Icon } from '../icon/index.tsx'
import type { IconName } from '../icon/index.tsx'
import { Text } from '../status/index.tsx'
import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'action',
  'action-leading',
  'action-label',
  'action-spinner',
  'action-group',
  'link',
] as const

export type ActionVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'
export type ActionTone = 'default' | 'danger' | 'positive'

export type ActionSize = 'compact' | 'default' | 'prominent' | 'large'

type ActionBase = {
  label: string
  id?: string
  variant?: ActionVariant
  tone?: ActionTone
  icon?: IconName
  fullWidth?: boolean
  pressed?: boolean
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
  /** For a button that shows or hides a region: whether that region is open now. */
  expanded?: boolean
  /** The id of the region an `expanded` button shows or hides. */
  controls?: string | null
}

export type LinkButtonProps = Omit<ActionBase, 'pressed'> & {
  href: string
  /** Keep native link navigation with the named, square icon-action contract. */
  iconOnly?: boolean
}
export type IconButtonProps = Omit<ButtonProps, 'leading' | 'icon'> & {
  icon: JSXChild
  pressed?: boolean
}

const ActionContent = (props: ActionBase & { iconOnly?: boolean }): TemplateResult => (
  <>
    {props.loading === true && (
      <span data-ui="action-spinner" aria-hidden="true">
        <Spinner label={props.label} size="small" decorative />
      </span>
    )}
    {(props.leading !== undefined || props.icon !== undefined) && (
      <span data-ui="action-leading" aria-hidden="true">
        {props.icon ? <Icon name={props.icon} /> : props.leading}
      </span>
    )}
    {!props.iconOnly && (
      <span data-ui="action-label">
        <Text>{props.label}</Text>
      </span>
    )}
  </>
)

const actionAttributes = (props: ActionBase) => ({
  id: props.id,
  'data-tone': props.tone ?? (props.variant === 'destructive' ? 'danger' : 'default'),
  'data-loading': props.loading ? 'true' : null,
  'data-full-width': props.fullWidth ? 'true' : null,
})

export const Button = (props: ButtonProps): TemplateResult => (
  <button
    {...actionAttributes(props)}
    data-ui="action"
    data-variant={props.variant ?? 'secondary'}
    data-size={props.size ?? 'default'}
    type={props.type ?? 'button'}
    name={props.name ?? null}
    value={props.value ?? null}
    form={props.form ?? null}
    disabled={props.disabled === true || props.loading === true}
    aria-label={props.loading ? props.label : null}
    aria-busy={props.loading === true ? 'true' : null}
    aria-pressed={props.pressed === undefined ? null : String(props.pressed)}
    aria-describedby={props.describedBy ?? null}
    aria-expanded={props.expanded === undefined ? null : String(props.expanded)}
    aria-controls={props.controls ?? null}
  >
    <ActionContent {...props} />
  </button>
)

/** Named icon action with a native title; compose Tooltip for an enhanced description. */
export const IconButton = (props: IconButtonProps): TemplateResult => (
  <button
    {...actionAttributes({ ...props, icon: undefined })}
    data-ui="action"
    data-icon-only="true"
    data-variant={props.variant ?? 'tertiary'}
    data-size={props.size ?? 'default'}
    type={props.type ?? 'button'}
    name={props.name ?? null}
    value={props.value ?? null}
    form={props.form ?? null}
    disabled={props.disabled === true || props.loading === true}
    aria-label={props.label}
    aria-pressed={props.pressed === undefined ? null : String(props.pressed)}
    aria-busy={props.loading === true ? 'true' : null}
    aria-describedby={props.describedBy ?? null}
    aria-expanded={props.expanded === undefined ? null : String(props.expanded)}
    aria-controls={props.controls ?? null}
    title={props.label}
  >
    <ActionContent {...props} icon={undefined} leading={props.icon} iconOnly />
  </button>
)

export const LinkButton = (props: LinkButtonProps): TemplateResult =>
  props.disabled || props.loading ? (
    <button
      {...actionAttributes(props)}
      data-ui="action"
      data-icon-only={props.iconOnly ? 'true' : null}
      data-variant={props.variant ?? 'secondary'}
      data-size={props.size ?? 'default'}
      type="button"
      disabled
      aria-label={props.loading || props.iconOnly ? props.label : null}
      title={props.iconOnly ? props.label : undefined}
      aria-busy={props.loading === true ? 'true' : null}
      aria-describedby={props.describedBy ?? null}
    >
      <ActionContent {...props} />
    </button>
  ) : (
    <a
      {...actionAttributes(props)}
      data-ui="action"
      data-icon-only={props.iconOnly ? 'true' : null}
      data-variant={props.variant ?? 'secondary'}
      data-size={props.size ?? 'default'}
      href={props.href}
      aria-label={props.iconOnly ? props.label : null}
      title={props.iconOnly ? props.label : undefined}
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

export type LinkProps = {
  label: string
  href: string
  id?: string
  tone?: 'default' | 'muted' | 'danger' | 'inherit'
  target?: '_self' | '_blank'
  download?: string
  describedBy?: string
}

/** Inline navigation. Use Button for commands and LinkButton for a navigation action. */
export const Link = (props: LinkProps): TemplateResult => (
  <a
    data-ui="link"
    data-tone={props.tone ?? 'default'}
    id={props.id}
    href={props.href}
    target={props.target ?? null}
    rel={props.target === '_blank' ? 'noopener noreferrer' : null}
    download={props.download ?? null}
    aria-describedby={props.describedBy ?? null}
  >
    {props.label}
  </a>
)
