import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type PartnerFact = { label: string; value: JSXChild }

export const PartnerPanel = (props: {
  id?: string
  title: string
  description?: string
  body: JSXChild
}): TemplateResult => (
  <section id={props.id} data-ui="partner-panel">
    <header data-ui="partner-panel-head">
      <h2 data-ui="partner-panel-title">{props.title}</h2>
      {!!props.description && <p data-ui="partner-panel-description">{props.description}</p>}
    </header>
    {props.body}
  </section>
)

export const PartnerFacts = (props: { items: PartnerFact[] }): TemplateResult => (
  <dl data-ui="partner-facts">
    {each(
      props.items,
      (item) => item.label,
      (item) => (
        <div data-ui="partner-fact">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ),
    )}
  </dl>
)

export const PartnerInitials = (props: { name: string }): TemplateResult => (
  <span data-ui="partner-initials">
    {props.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase())
      .join('')}
  </span>
)
