import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'list-page',
  'list-page-header',
  'list-page-heading',
  'list-page-title-row',
  'list-page-eyebrow',
  'list-page-title',
  'list-page-description',
  'list-page-actions',
  'list-page-toolbar',
  'list-page-controls',
  'list-page-status',
  'list-page-body',
  'list-page-footer',
] as const

export type ListPageProps = {
  title: string
  body: JSXChild
  eyebrow?: string | null
  description?: string | null
  actions?: JSXChild
  controls?: JSXChild
  status?: JSXChild
  footer?: JSXChild
}

/**
 * The baseline for an operational collection screen.
 *
 * Applications own the translated copy, URL-driven controls and records. This
 * pattern owns their order and rhythm: identity and primary action first, query
 * controls second, then the result status and the collection itself.
 */
export const ListPage = (props: ListPageProps): TemplateResult => (
  <section data-ui="list-page">
    <header data-ui="list-page-header">
      <div data-ui="list-page-heading">
        {!!props.eyebrow && <p data-ui="list-page-eyebrow">{props.eyebrow}</p>}
        <div data-ui="list-page-title-row">
          <h1 data-ui="list-page-title">{props.title}</h1>
          {props.actions !== undefined && <div data-ui="list-page-actions">{props.actions}</div>}
        </div>
        {!!props.description && <p data-ui="list-page-description">{props.description}</p>}
      </div>
    </header>
    {(props.controls !== undefined || props.status !== undefined) && (
      <div data-ui="list-page-toolbar">
        {props.status !== undefined && <div data-ui="list-page-status">{props.status}</div>}
        {props.controls !== undefined && <div data-ui="list-page-controls">{props.controls}</div>}
      </div>
    )}
    <div data-ui="list-page-body">{props.body}</div>
    {props.footer !== undefined && <footer data-ui="list-page-footer">{props.footer}</footer>}
  </section>
)
