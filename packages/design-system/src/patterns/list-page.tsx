import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentity } from './page-shell.tsx'

export const HOOKS = [
  'list-page',
  'list-page-context',
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
  /**
   * A narrow application context strip above the page identity. The application
   * owns its breadcrumbs and organisation switcher; the pattern owns the slot.
   */
  context?: JSXChild
  /**
   * `operational` is the full workspace composition used by application collection
   * screens. The unadorned variant remains available for embedded specimens.
   */
  variant?: 'operational'
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
export const ListPage = (props: ListPageProps): TemplateResult => {
  const operational = props.variant === 'operational'
  // Result summaries close the collection in an operational workspace. Keeping
  // the legacy `status` prop as the input lets existing screens migrate without
  // duplicating their translated count as a separate footer value.
  const toolbarStatus = operational ? undefined : props.status
  const footer = props.footer ?? (operational ? props.status : undefined)

  return (
    <section data-ui="list-page" data-variant={props.variant ?? null} data-pattern="list">
      {pageIdentity('list-page', {
        context: props.context,
        eyebrow: props.eyebrow,
        title: props.title,
        description: props.description,
        actions: props.actions,
      })}
      {(props.controls !== undefined || toolbarStatus !== undefined) && (
        <div data-ui="list-page-toolbar">
          {toolbarStatus !== undefined && <div data-ui="list-page-status">{toolbarStatus}</div>}
          {props.controls !== undefined && <div data-ui="list-page-controls">{props.controls}</div>}
        </div>
      )}
      <div data-ui="list-page-body">{props.body}</div>
      {footer !== undefined && <footer data-ui="list-page-footer">{footer}</footer>}
    </section>
  )
}
