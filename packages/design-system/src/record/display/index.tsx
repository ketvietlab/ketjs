import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Avatar, Badge } from '../../primitives/status/index.tsx'
import type { Tone } from '../../primitives/status/index.tsx'

export const HOOKS = [
  'description-list',
  'key-value',
  'key-value-label',
  'key-value-value',
  'person',
  'person-body',
  'avatar-group',
  'status',
] as const

export type KeyValueProps = { label: JSXChild; value: JSXChild; emptyLabel?: string }
export const KeyValue = (props: KeyValueProps): TemplateResult => (
  <div data-ui="key-value">
    <dt data-ui="key-value-label">{props.label}</dt>
    <dd data-ui="key-value-value">{props.value ?? props.emptyLabel ?? '—'}</dd>
  </div>
)

export const DescriptionList = (props: {
  label?: string
  items: readonly (KeyValueProps & { id: string })[]
  columns?: 1 | 2 | 3
}): TemplateResult => (
  <dl data-ui="description-list" aria-label={props.label} data-columns={String(props.columns ?? 2)}>
    {each(
      props.items,
      (item) => item.id,
      (item) => (
        <KeyValue {...item} />
      ),
    )}
  </dl>
)

export type PersonProps = {
  name: string
  detail?: JSXChild
  href?: string
  size?: 'small' | 'default' | 'large'
}
export const Person = (props: PersonProps): TemplateResult => (
  <span data-ui="person">
    <Avatar name={props.name} size={props.size} />
    <span data-ui="person-body">
      {props.href ? <a href={props.href}>{props.name}</a> : <strong>{props.name}</strong>}
      {props.detail !== undefined && <small>{props.detail}</small>}
    </span>
  </span>
)

export const AvatarGroup = (props: {
  label: string
  people: readonly { id: string; name: string }[]
  max?: number
}): TemplateResult => {
  const visible = props.people.slice(0, props.max ?? 4)
  const remaining = props.people.length - visible.length
  return (
    <span data-ui="avatar-group" aria-label={props.label}>
      {each(
        visible,
        (person) => person.id,
        (person) => (
          <Avatar name={person.name} />
        ),
      )}
      {remaining > 0 && <span aria-label={`${remaining} more people`}>+{String(remaining)}</span>}
    </span>
  )
}

export const Status = (props: { label: string; tone?: Tone; detail?: string }): TemplateResult => (
  <span data-ui="status" title={props.detail}>
    <Badge label={props.label} tone={props.tone} />
  </span>
)
