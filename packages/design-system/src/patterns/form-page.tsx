import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'form-page',
  'form-page-header',
  'form-page-title-row',
  'form-page-heading',
  'form-page-title',
  'form-page-subline',
  'form-page-status',
  'form-page-description',
  'form-page-actions',
  'form-page-meta',
  'form-page-navigation',
  'form-page-layout',
  'form-page-body',
  'form-page-aside',
] as const

export type FormPageProps = {
  title: string
  body: JSXChild
  description?: string | null
  status?: JSXChild
  actions?: JSXChild
  meta?: JSXChild
  navigation?: JSXChild
  aside?: JSXChild
  asideLabel?: string | null
}

/**
 * The baseline for an operational create or edit screen.
 *
 * Applications own translated copy, fields and business actions. This pattern
 * keeps record identity and the primary decision together, gives the form one
 * stable reading column, and reserves an optional rail for durable context.
 */
export const FormPage = (props: FormPageProps): TemplateResult => (
  <section data-ui="form-page" data-has-aside={String(props.aside !== undefined)}>
    <header data-ui="form-page-header">
      <div data-ui="form-page-title-row">
        <div data-ui="form-page-heading">
          <h1 data-ui="form-page-title">{props.title}</h1>
          {(!!props.description || props.status !== undefined) && (
            <div data-ui="form-page-subline">
              {!!props.description && <p data-ui="form-page-description">{props.description}</p>}
              {props.status !== undefined && <span data-ui="form-page-status">{props.status}</span>}
            </div>
          )}
        </div>
        {props.actions !== undefined && <div data-ui="form-page-actions">{props.actions}</div>}
      </div>
      {props.meta !== undefined && <div data-ui="form-page-meta">{props.meta}</div>}
    </header>
    {props.navigation !== undefined && <div data-ui="form-page-navigation">{props.navigation}</div>}
    <div data-ui="form-page-layout">
      <main data-ui="form-page-body">{props.body}</main>
      {props.aside !== undefined && (
        <aside data-ui="form-page-aside" aria-label={props.asideLabel ?? null}>
          {props.aside}
        </aside>
      )}
    </div>
  </section>
)
