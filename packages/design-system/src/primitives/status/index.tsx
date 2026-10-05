import { Icon } from '../icon/index.tsx'
import type { IconName } from '../icon/index.tsx'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'badge',
  'badge-pip',
  'tag-label',
  'avatar-image',
  'avatar-initials',
  'tag',
  'tag-remove',
  'count-badge',
  'avatar',
  'code',
  'text',
  'media-label',
  'media-label-image',
  'media-label-copy',
] as const

export type TextVariant =
  | 'bodyXs'
  | 'bodySm'
  | 'bodyMd'
  | 'bodyLg'
  | 'headingXs'
  | 'headingSm'
  | 'headingMd'
  | 'headingLg'
  | 'headingXl'
  | 'heading2xl'
  | 'heading3xl'
export type TextProps = {
  children: JSXChild
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'strong' | 'dt' | 'dd' | 'legend'
  id?: string
  variant?: TextVariant
  tone?: 'default' | 'muted' | 'disabled' | 'info' | 'positive' | 'warning' | 'danger' | 'inherit'
  fontWeight?: 'regular' | 'medium' | 'semibold' | 'bold'
  alignment?: 'start' | 'center' | 'end'
  numeric?: boolean
  truncate?: boolean
  breakWord?: boolean
  visuallyHidden?: boolean
}

/** Typography role is independent of document heading level. Omitted variant inherits. */
export const Text = (props: TextProps): TemplateResult => {
  const Element = props.as ?? 'span'
  return (
    <Element
      data-ui="text"
      id={props.id}
      data-tone={props.tone ?? 'default'}
      data-variant={props.variant ?? null}
      data-weight={props.fontWeight ?? null}
      data-align={props.alignment ?? null}
      data-numeric={props.numeric ? 'true' : null}
      data-truncate={props.truncate ? 'true' : null}
      data-break-word={props.breakWord ? 'true' : null}
      data-visually-hidden={props.visuallyHidden ? 'true' : null}
    >
      {props.children}
    </Element>
  )
}

/**
 * A readable row name with optional media. Empty collections do not pay for an unused image column.
 * A reserved slot without an image shows a muted placeholder icon, so a row that has no photo
 * reads as "no photo" rather than as a missing one.
 */
export const MediaLabel = (props: {
  label: string
  src?: string
  reserveImage?: boolean
  /** Glyph drawn in a reserved slot that has no image. */
  placeholder?: IconName
}): TemplateResult => (
  <span data-ui="media-label">
    {props.src || props.reserveImage ? (
      <span data-ui="media-label-image" data-empty={props.src ? null : 'true'} aria-hidden="true">
        {props.src ? (
          <img src={props.src} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name={props.placeholder ?? 'image'} size="small" tone="muted" />
        )}
      </span>
    ) : null}
    <span data-ui="media-label-copy">{props.label}</span>
  </span>
)

export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export type BadgeProps = {
  label: string
  tone?: Tone
  value?: string
  size?: 'small' | 'default'
} & (
  | { icon?: IconName; progress?: never }
  | { icon?: never; progress?: 'incomplete' | 'partiallyComplete' | 'complete'; progressLabel?: string }
)

export const Badge = (props: BadgeProps): TemplateResult => (
  <span
    data-ui="badge"
    data-pattern="badge"
    data-tone={props.tone ?? 'neutral'}
    data-size={props.size ?? 'default'}
    data-value={props.value ?? ''}
  >
    {props.icon && <Icon name={props.icon} size="small" />}
    {props.progress && <span data-ui="badge-pip" data-progress={props.progress} aria-hidden="true" />}
    {props.progress && (
      <span data-ui="visually-hidden">
        {props.progressLabel ??
          (
            {
              incomplete: 'Incomplete',
              partiallyComplete: 'Partially complete',
              complete: 'Complete',
            } as const
          )[props.progress]}
        :{' '}
      </span>
    )}
    <Text>{props.label}</Text>
  </span>
)

export type TagProps = {
  label: string
  href?: string
  removeHref?: string | null
  removeLabel?: string | null
  /** A native form command; form can target an external form. */
  removeCommand?: { name: string; value: string; form?: string }
  disabled?: boolean
  truncate?: boolean
}

export const Tag = (props: TagProps): TemplateResult => (
  <span
    data-ui="tag"
    data-truncate={props.truncate ? 'true' : null}
    aria-disabled={props.disabled ? 'true' : null}
  >
    {props.href && !props.disabled ? (
      <a data-ui="tag-label" href={props.href}>
        {props.label}
      </a>
    ) : (
      <span data-ui="tag-label">{props.label}</span>
    )}
    {props.removeCommand ? (
      <button
        data-ui="tag-remove"
        type="submit"
        name={props.removeCommand.name}
        value={props.removeCommand.value}
        form={props.removeCommand.form ?? null}
        disabled={props.disabled === true}
        aria-label={props.removeLabel ?? `Remove ${props.label}`}
      >
        <Icon name="x" size="small" />
      </button>
    ) : props.removeHref ? (
      props.disabled ? (
        <button
          data-ui="tag-remove"
          type="button"
          disabled
          aria-label={props.removeLabel ?? `Remove ${props.label}`}
        >
          <Icon name="x" size="small" />
        </button>
      ) : (
        <a
          data-ui="tag-remove"
          href={props.removeHref}
          aria-label={props.removeLabel ?? `Remove ${props.label}`}
        >
          <Icon name="x" size="small" />
        </a>
      )
    ) : null}
  </span>
)

export const CountBadge = (props: { count: number; label: string; announce?: boolean }): TemplateResult => (
  <span data-ui="count-badge" role={props.announce ? 'status' : undefined}>
    <span aria-hidden="true">
      <Text numeric>{String(props.count)}</Text>
    </span>
    <span data-ui="visually-hidden">{props.label}</span>
  </span>
)

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!
  const second = parts.length > 2 ? parts[parts.length - 2]! : ''
  return (second.slice(0, 1) + first.slice(0, 1)).toLocaleUpperCase('vi')
}

export type AvatarProps = {
  name: string
  size?: 'small' | 'default' | 'large'
  src?: string
  /** Informative when rendered alone; defaults to decoration beside a name. */
  decorative?: boolean
}

export const Avatar = (props: AvatarProps): TemplateResult => (
  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: only the informative img branch has an accessible name.
  <span
    data-ui="avatar"
    data-pattern="avatar"
    data-size={props.size ?? 'default'}
    title={props.name}
    role={props.decorative === false ? 'img' : undefined}
    aria-label={props.decorative === false ? props.name : null}
    aria-hidden={props.decorative === false ? null : 'true'}
  >
    <span data-ui="avatar-initials">{initials(props.name)}</span>
    {props.src && <img data-ui="avatar-image" src={props.src} alt="" loading="lazy" decoding="async" />}
  </span>
)

export const Code = (props: { value: string; context?: string | null }): TemplateResult => (
  <code data-ui="code" data-context={props.context ?? null}>
    {props.value}
  </code>
)
