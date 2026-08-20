// The smallest pieces: a status, a person, a button.
//
// Every one of them owns exactly one data-ui root, declared in HOOKS below. A
// module composes these; it does not write the markup, which is what stops the
// stylesheet's contract drifting one screen at a time.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'

/** The data-ui names this file emits. See ui/hooks.ts. */
export const HOOKS = [
  'inline',
  'code',
  'badge',
  'tag',
  'tag-remove',
  'count-badge',
  'person',
  'person-name',
  'avatar',
  'app-action',
] as const

/** Small values on one line, allowed to wrap without a caller writing a container. */
export const inline = (items: readonly JSXChild[]): TemplateResult => (
  <span data-ui="inline">
    {each(
      items,
      (_, i) => i,
      (item) => (
        <>{item}</>
      ),
    )}
  </span>
)

/**
 * A value meant to be read exactly: an id, a path, a unit code.
 *
 * `hook` is there because two places style these differently and the stylesheet
 * was written against those names. It is a value rather than free markup, so the
 * contract test still catches a name nobody registered.
 */
export const code = (value: string | null, context?: string): TemplateResult => (
  <code data-ui="code" data-context={context ?? null}>
    {value}
  </code>
)

/**
 * A status, as a word with a colour behind it.
 *
 * The tone is named for what it means, not for what it looks like: a design team
 * that wants "draft" to be amber changes one token, and every draft in the product
 * follows. `data-value` carries the raw state as well, so a stylesheet can be more
 * specific when it has to be.
 */
export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export const badge = (label: string, tone: Tone = 'neutral', value?: string): TemplateResult => (
  <span data-ui="badge" data-tone={tone} data-value={value ?? ''}>
    {label}
  </span>
)

/** A categorical label or active filter; unlike a status it has no semantic tone. */
export const tag = (o: {
  label: string
  removeHref?: string | null
  removeLabel?: string
}): TemplateResult => (
  <span data-ui="tag">
    {o.label}
    {!!o.removeHref && (
      <a data-ui="tag-remove" href={o.removeHref} aria-label={o.removeLabel ?? `Bỏ ${o.label}`}>
        ×
      </a>
    )}
  </span>
)

/** A short quantity. The caller supplies the accessible context, not only a number. */
export const countBadge = (count: number, label: string): TemplateResult => (
  <span data-ui="count-badge" role="status" aria-label={label}>
    {String(count)}
  </span>
)

/**
 * Initials in a circle.
 *
 * Not a photograph: nothing in the product stores one yet, and a broken image in
 * every row of a list is worse than no image at all. When avatars do arrive this
 * stays as the fallback, which is what it would have had to be anyway.
 */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  // Vietnamese names put the given name last, and that is the one people answer to.
  const first = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!
  const second = parts.length > 2 ? parts[parts.length - 2]! : ''
  return (second.slice(0, 1) + first.slice(0, 1)).toLocaleUpperCase('vi')
}

export const avatar = (name: string): TemplateResult => (
  <span data-ui="avatar" title={name} aria-hidden="true">
    {initials(name)}
  </span>
)

/** A name with its avatar — the shape a person's column takes in every list. */
export const person = (name: string): TemplateResult => (
  <span data-ui="person">
    {avatar(name)}
    <span data-ui="person-name">{name}</span>
  </span>
)

/**
 * A button that acts on the row or card it sits in.
 *
 * `action` is what it does, not how it looks — the stylesheet decides that the
 * primary one is filled and the rest are outlined, and no caller passes a colour.
 */
export const actionButton = (o: { label: string; action: string; disabled?: boolean }): TemplateResult => (
  <button type="button" data-ui="app-action" data-action={o.action} disabled={o.disabled === true}>
    {o.label}
  </button>
)
