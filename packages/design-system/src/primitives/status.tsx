import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['badge', 'tag', 'tag-remove', 'count-badge', 'avatar', 'code'] as const

export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export const Badge = (props: { label: string; tone?: Tone; value?: string }): TemplateResult => (
  <span data-ui="badge" data-tone={props.tone ?? 'neutral'} data-value={props.value ?? ''}>
    {props.label}
  </span>
)

export const Tag = (props: {
  label: string
  removeHref?: string | null
  removeLabel?: string | null
}): TemplateResult => (
  <span data-ui="tag">
    {props.label}
    {!!props.removeHref && (
      <a
        data-ui="tag-remove"
        href={props.removeHref}
        aria-label={props.removeLabel ?? `Remove ${props.label}`}
      >
        ×
      </a>
    )}
  </span>
)

export const CountBadge = (props: { count: number; label: string }): TemplateResult => (
  <span data-ui="count-badge" role="status" aria-label={props.label}>
    {String(props.count)}
  </span>
)

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!
  const second = parts.length > 2 ? parts[parts.length - 2]! : ''
  return (second.slice(0, 1) + first.slice(0, 1)).toLocaleUpperCase('vi')
}

export const Avatar = (props: { name: string; size?: 'small' | 'default' | 'large' }): TemplateResult => (
  <span data-ui="avatar" data-size={props.size ?? 'default'} title={props.name} aria-hidden="true">
    {initials(props.name)}
  </span>
)

export const Code = (props: { value: string; context?: string | null }): TemplateResult => (
  <code data-ui="code" data-context={props.context ?? null}>
    {props.value}
  </code>
)
