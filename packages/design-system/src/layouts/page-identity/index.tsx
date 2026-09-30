import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type PageIdentityKind =
  | 'page'
  | 'list-page'
  | 'record-page'
  | 'form-page'
  | 'workspace-page'
  | 'dashboard-page'
  | 'board-page'

export type PageIdentityProps = {
  context?: JSXChild
  eyebrow?: string | null
  title: string
  status?: JSXChild
  actions?: JSXChild
  /** Retain action content while removing an empty or conditional identity slot from layout. */
  actionsHidden?: boolean
  meta?: JSXChild
}

/**
 * The single identity band shared by every full-page component and recipe.
 *
 * A page identity has no description: every page header keeps one height, so
 * switching screens never moves the controls and content below it. Explain a
 * section inside the section, or put guidance in the empty state.
 */
export const pageIdentityContent = (kind: PageIdentityKind, props: PageIdentityProps): TemplateResult => (
  <>
    <div data-ui={`${kind}-heading`} data-kv-page-identity="heading">
      {!!props.eyebrow && (
        <p data-ui={`${kind}-eyebrow`} data-kv-page-identity="eyebrow">
          {props.eyebrow}
        </p>
      )}
      <div data-ui={`${kind}-title-row`} data-kv-page-identity="title-row">
        <h1 data-ui={`${kind}-title`} data-kv-page-identity="title">
          {props.title}
        </h1>
        {props.actions !== undefined && (
          <div
            data-ui={`${kind}-actions`}
            data-kv-page-identity="actions"
            hidden={props.actionsHidden === true}
          >
            {props.actions}
          </div>
        )}
      </div>
      {props.status !== undefined && (
        <div data-ui={`${kind}-subline`} data-kv-page-identity="subline">
          <span data-ui={`${kind}-status`} data-kv-page-identity="status">
            {props.status}
          </span>
        </div>
      )}
    </div>
    {props.meta !== undefined && (
      <div data-ui={`${kind}-meta`} data-kv-page-identity="meta">
        {props.meta}
      </div>
    )}
  </>
)

export const pageIdentity = (kind: PageIdentityKind, props: PageIdentityProps): TemplateResult => (
  <>
    {props.context != null && (
      <div data-ui={`${kind}-context`} data-kv-page-identity="context">
        {props.context}
      </div>
    )}
    <header data-ui={`${kind}-header`} data-kv-page-identity="header">
      {pageIdentityContent(kind, props)}
    </header>
  </>
)
