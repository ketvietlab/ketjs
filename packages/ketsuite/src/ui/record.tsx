// A dense operational record workspace.
//
// ERP records need two things at the same time: a compact identity/summary that
// survives navigation between tabs, and a collaboration rail that does not push
// the business form several screens down. The module supplies meaning and data;
// this component owns only that stable arrangement.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'

export const HOOKS = [
  'record-workspace',
  'record-sheet',
  'record-header',
  'record-identity',
  'record-thumbnail',
  'record-kicker',
  'record-heading',
  'record-subtitle',
  'record-badges',
  'record-toggle',
  'record-toggle-input',
  'record-toggle-label',
  'record-facts',
  'record-fact',
  'record-fact-value',
  'record-fact-label',
  'record-navigation',
  'record-controller',
  'record-body',
  'record-aside',
] as const

export type RecordSummaryItem = {
  id: string
  label: string
  value: string | number
  href?: string | null
}

export const recordToggle = (options: {
  name: string
  label: string
  checked: boolean
  form?: string | null
  disabled?: boolean
}): TemplateResult => (
  <label data-ui="record-toggle" data-disabled={String(options.disabled === true)}>
    <input
      data-ui="record-toggle-input"
      type="checkbox"
      name={options.name}
      value="1"
      checked={options.checked}
      form={options.form ?? undefined}
      disabled={options.disabled === true}
    />
    <span data-ui="record-toggle-label">{options.label}</span>
  </label>
)

const summaryContent = (item: RecordSummaryItem): TemplateResult => (
  <>
    <strong data-ui="record-fact-value">{String(item.value)}</strong>
    <span data-ui="record-fact-label">{item.label}</span>
  </>
)

export const recordWorkspace = (options: {
  kicker?: string | null
  title: string
  subtitle?: string | null
  image?: { src: string; alt: string } | null
  imageFallback: JSXChild
  badges?: readonly JSXChild[]
  summary?: readonly RecordSummaryItem[]
  navigation?: JSXChild
  controller?: JSXChild
  body: JSXChild
  aside?: JSXChild
  asideLabel?: string | null
}): TemplateResult => (
  <div data-ui="record-workspace" data-has-aside={String(options.aside !== undefined)}>
    <section data-ui="record-sheet">
      <header data-ui="record-header">
        <div data-ui="record-identity">
          <div data-ui="record-thumbnail" data-empty={String(!options.image)}>
            {options.image ? <img src={options.image.src} alt={options.image.alt} /> : options.imageFallback}
          </div>
          <div>
            {!!options.kicker && <p data-ui="record-kicker">{options.kicker}</p>}
            <h1 data-ui="record-heading">{options.title}</h1>
            {!!options.subtitle && <p data-ui="record-subtitle">{options.subtitle}</p>}
          </div>
        </div>
        {!!options.summary?.length && (
          <div data-ui="record-facts">
            {each(
              options.summary,
              (item) => item.id,
              (item) =>
                item.href ? (
                  <a data-ui="record-fact" href={item.href}>
                    {summaryContent(item)}
                  </a>
                ) : (
                  <div data-ui="record-fact">{summaryContent(item)}</div>
                ),
            )}
          </div>
        )}
        {!!options.badges?.length && (
          <div data-ui="record-badges">
            {each(
              options.badges,
              (_, index) => index,
              (item) => (
                <>{item}</>
              ),
            )}
          </div>
        )}
      </header>
      {options.navigation !== undefined && <div data-ui="record-navigation">{options.navigation}</div>}
      {options.controller !== undefined && <div data-ui="record-controller">{options.controller}</div>}
      <div data-ui="record-body">{options.body}</div>
    </section>
    {options.aside !== undefined && (
      <aside data-ui="record-aside" aria-label={options.asideLabel ?? null}>
        {options.aside}
      </aside>
    )}
  </div>
)
