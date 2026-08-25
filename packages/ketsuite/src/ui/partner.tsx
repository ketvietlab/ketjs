import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type PartnerFact = { label: string; value: JSXChild }
export type PartnerStat = { label: string; value: string | number; href?: string }

export const PartnerListLayout = (props: {
  tabs: Array<{ id: string; label: string; count: number; href: string; active: boolean }>
  table: JSXChild
  title: string
  stats: PartnerStat[]
}): TemplateResult => (
  <div data-ui="partner-list-layout">
    <section data-ui="partner-list-main">
      <nav data-ui="partner-list-tabs" aria-label={props.title}>
        {each(
          props.tabs,
          (tab) => tab.id,
          (tab) => (
            <a data-ui="partner-list-tab" data-active={String(tab.active)} href={tab.href}>
              <span>{tab.label}</span>
              <span data-ui="partner-list-count">{String(tab.count)}</span>
            </a>
          ),
        )}
      </nav>
      {props.table}
    </section>
    <aside data-ui="partner-list-rail" aria-label={props.title}>
      <h2 data-ui="partner-panel-title">{props.title}</h2>
      <div data-ui="partner-stat-grid">
        {each(
          props.stats,
          (stat) => stat.label,
          (stat) => (
            <div data-ui="partner-stat">
              <span>{stat.label}</span>
              <strong>{String(stat.value)}</strong>
            </div>
          ),
        )}
      </div>
    </aside>
  </div>
)

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

export const PartnerDetailLayout = (props: {
  main: JSXChild
  secondary: JSXChild
  aside: JSXChild
}): TemplateResult => (
  <div data-ui="partner-detail-layout">
    <div data-ui="partner-detail-main">{props.main}</div>
    <div data-ui="partner-detail-secondary">{props.secondary}</div>
    <aside data-ui="partner-detail-rail">{props.aside}</aside>
  </div>
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
