// Actions are a hierarchy, not a colour choice.
//
// A screen says whether an action is primary, secondary, quiet or destructive;
// the operational stylesheet decides how that role looks. Links stay links and
// form actions stay buttons, so keyboard, open-in-new-tab and no-JavaScript flows
// keep their native behaviour.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { icon } from './icons.ts'

export const HOOKS = ['action', 'action-icon', 'action-label', 'action-spinner', 'action-group'] as const

export type ActionVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'
export type ActionSize = 'compact' | 'default' | 'prominent'

type ActionBase = {
  label: string
  variant?: ActionVariant
  size?: ActionSize
  icon?: string | null
  disabled?: boolean
  loading?: boolean
  describedBy?: string | null
}

export type ButtonSpec = ActionBase & {
  type?: 'button' | 'submit' | 'reset'
  name?: string | null
  value?: string | null
  /** Associate a submit control with a form elsewhere in the document. */
  form?: string | null
}

export type LinkButtonSpec = ActionBase & { href: string }

const content = (o: ActionBase, iconOnly = false): TemplateResult => (
  <>
    {o.loading === true && <span data-ui="action-spinner" aria-hidden="true" />}
    {o.loading !== true && !!o.icon && <span data-ui="action-icon">{icon(o.icon)}</span>}
    {!iconOnly && <span data-ui="action-label">{o.label}</span>}
  </>
)

/** A native button for an action handled by its form or an island. */
export const button = (o: ButtonSpec): TemplateResult => (
  <button
    data-ui="action"
    data-variant={o.variant ?? 'secondary'}
    data-size={o.size ?? 'default'}
    type={o.type ?? 'button'}
    name={o.name ?? null}
    value={o.value ?? null}
    form={o.form ?? null}
    disabled={o.disabled === true || o.loading === true}
    aria-busy={o.loading === true ? 'true' : null}
    aria-describedby={o.describedBy ?? null}
  >
    {content(o)}
  </button>
)

/** A navigation action. Disabled links lose href rather than pretending to work. */
export const linkButton = (o: LinkButtonSpec): TemplateResult =>
  o.disabled ? (
    <button
      data-ui="action"
      data-variant={o.variant ?? 'secondary'}
      data-size={o.size ?? 'default'}
      type="button"
      disabled
      aria-describedby={o.describedBy ?? null}
    >
      {content(o)}
    </button>
  ) : (
    <a
      data-ui="action"
      data-variant={o.variant ?? 'secondary'}
      data-size={o.size ?? 'default'}
      href={o.href}
      aria-describedby={o.describedBy ?? null}
    >
      {content(o)}
    </a>
  )

/** Icon-only controls keep a visible tooltip and an accessible name. */
export const iconButton = (o: (ButtonSpec | LinkButtonSpec) & { icon: string }): TemplateResult =>
  'href' in o ? (
    o.disabled ? (
      <button
        data-ui="action"
        data-icon-only="true"
        data-variant={o.variant ?? 'tertiary'}
        data-size={o.size ?? 'default'}
        type="button"
        disabled
        aria-label={o.label}
        title={o.label}
      >
        {content(o, true)}
      </button>
    ) : (
      <a
        data-ui="action"
        data-icon-only="true"
        data-variant={o.variant ?? 'tertiary'}
        data-size={o.size ?? 'default'}
        href={o.href}
        aria-label={o.label}
        title={o.label}
      >
        {content(o, true)}
      </a>
    )
  ) : (
    <button
      data-ui="action"
      data-icon-only="true"
      data-variant={o.variant ?? 'tertiary'}
      data-size={o.size ?? 'default'}
      type={o.type ?? 'button'}
      disabled={o.disabled === true || o.loading === true}
      aria-busy={o.loading === true ? 'true' : null}
      aria-label={o.label}
      title={o.label}
    >
      {content(o, true)}
    </button>
  )

/** One cluster, and therefore at most one primary action. */
export const actionGroup = (o: {
  actions: readonly TemplateResult[]
  label?: string | null
}): TemplateResult => (
  <div data-ui="action-group" role="group" aria-label={o.label ?? null}>
    {each(
      o.actions,
      (_, i) => i,
      (action) => action,
    )}
  </div>
)
