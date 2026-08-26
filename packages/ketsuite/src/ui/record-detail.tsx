// Reusable composition pieces for dense record forms.
//
// Modules provide labels, values and actions. This file owns the markup so a
// future module can add a record rail or forward-compatible field without
// copying the Product screen's DOM and CSS contract.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { button, iconButton, linkButton } from './actions.tsx'
import { icon } from './icons.ts'

export const HOOKS = [
  'record-field-grid',
  'record-rail',
  'record-rail-card',
  'record-system-facts',
  'record-switches',
  'record-switch',
  'record-switch-input',
  'record-activity-list',
  'record-activity-item',
  'record-header-actions',
  'record-more',
  'record-more-open',
  'record-more-menu',
  'record-save-split',
] as const

export const readonlyField = (options: {
  id: string
  label: string
  value?: string
  future?: boolean
}): TemplateResult => (
  <label data-ui="form-field" data-record-field={options.id} for={`record-readonly-${options.id}`}>
    <span data-ui="form-label">{options.label}</span>
    <input
      id={`record-readonly-${options.id}`}
      data-ui="form-control"
      data-future-field={options.future === true ? 'true' : null}
      type="text"
      value={options.value ?? ''}
      readonly
      autocomplete="off"
    />
  </label>
)

export const readonlyTextarea = (options: {
  id: string
  label: string
  placeholder?: string
  future?: boolean
}): TemplateResult => (
  <textarea
    data-ui="form-control"
    data-record-field={options.id}
    data-future-field={options.future === true ? 'true' : null}
    aria-label={options.label}
    placeholder={options.placeholder ?? null}
    readonly
    autocomplete="off"
  />
)

export const recordFieldGrid = (options: { fields: readonly JSXChild[] }): TemplateResult => (
  <div data-ui="record-field-grid">
    {each(
      options.fields,
      (_, index) => index,
      (field) => (
        <>{field}</>
      ),
    )}
  </div>
)

export type RecordRailFact = {
  id: string
  label: string
  value: string
  divider?: boolean
}

export type RecordRailSwitch = {
  id: string
  label: string
  icon?: string | null
  checked?: boolean
  future?: boolean
}

export type RecordRailActivity = {
  id: string
  label: string
  detail: string
  icon: string
  tone?: 'primary' | 'success'
}

export const recordRail = (options: {
  system: { title: string; facts: readonly RecordRailFact[] }
  switches: {
    title: string
    description?: string | null
    items: readonly RecordRailSwitch[]
    actionLabel: string
  }
  activity: { title: string; items: readonly RecordRailActivity[]; actionLabel: string }
}): TemplateResult => (
  <div data-ui="record-rail">
    <section data-ui="record-rail-card">
      <h2>{options.system.title}</h2>
      <dl data-ui="record-system-facts">
        {each(
          options.system.facts,
          (fact) => fact.id,
          (fact) => (
            <div data-record-divider={String(fact.divider === true)}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
    <section data-ui="record-rail-card">
      <h2>{options.switches.title}</h2>
      {!!options.switches.description && <p>{options.switches.description}</p>}
      <div data-ui="record-switches">
        {each(
          options.switches.items,
          (item) => item.id,
          (item) => (
            <label data-ui="record-switch" for={`record-switch-${item.id}`}>
              <span>
                {icon(item.icon)}
                {item.label}
              </span>
              <input
                id={`record-switch-${item.id}`}
                data-ui="record-switch-input"
                data-future-field={item.future === true ? 'true' : null}
                type="checkbox"
                checked={item.checked === true}
                disabled
                autocomplete="off"
              />
            </label>
          ),
        )}
      </div>
      {button({ label: options.switches.actionLabel, variant: 'secondary' })}
    </section>
    <section data-ui="record-rail-card">
      <h2>{options.activity.title}</h2>
      <div data-ui="record-activity-list">
        {each(
          options.activity.items,
          (item) => item.id,
          (item) => (
            <div data-ui="record-activity-item">
              <span data-tone={item.tone ?? 'primary'}>{icon(item.icon)}</span>
              <p>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </p>
            </div>
          ),
        )}
      </div>
      {button({ label: options.activity.actionLabel, variant: 'secondary' })}
    </section>
  </div>
)

export const recordHeaderActions = (options: {
  label: string
  form?: string | null
  saveHref?: string | null
  more?: JSXChild
  moreLabel: string
  noteLabel: string
  saveLabel: string
  saveOptionsLabel: string
}): TemplateResult => (
  <div data-ui="record-header-actions" role="group" aria-label={options.label}>
    {options.more !== undefined ? (
      <details data-ui="record-more">
        <summary
          data-ui="record-more-open"
          data-variant="secondary"
          aria-label={options.moreLabel}
          title={options.moreLabel}
        >
          {icon('more-horizontal')}
        </summary>
        <div data-ui="record-more-menu">{options.more}</div>
      </details>
    ) : (
      iconButton({ label: options.moreLabel, icon: 'more-horizontal', variant: 'secondary' })
    )}
    {button({ label: options.noteLabel, icon: 'file-text', variant: 'secondary' })}
    <div data-ui="record-save-split">
      {options.form
        ? button({ label: options.saveLabel, type: 'submit', form: options.form, variant: 'primary' })
        : linkButton({ label: options.saveLabel, href: options.saveHref ?? '#', variant: 'primary' })}
      {options.form ? (
        <button
          data-ui="action"
          data-variant="primary"
          data-size="default"
          data-record-save-options="true"
          type="submit"
          form={options.form}
          aria-label={options.saveOptionsLabel}
          title={options.saveOptionsLabel}
        >
          {icon('chevron-down')}
        </button>
      ) : (
        <a
          data-ui="action"
          data-variant="primary"
          data-size="default"
          data-record-save-options="true"
          href={options.saveHref ?? '#'}
          aria-label={options.saveOptionsLabel}
          title={options.saveOptionsLabel}
        >
          {icon('chevron-down')}
        </a>
      )}
    </div>
  </div>
)
