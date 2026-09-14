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
  description?: string | null
  status?: JSXChild
  actions?: JSXChild
  meta?: JSXChild
}

type PageIdentityContentProps = PageIdentityProps & {
  groupDescription?: boolean
}

/** The single identity band shared by every full-page component and recipe. */
export const pageIdentityContent = (
  kind: PageIdentityKind,
  props: PageIdentityContentProps,
): TemplateResult => (
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
          <div data-ui={`${kind}-actions`} data-kv-page-identity="actions">
            {props.actions}
          </div>
        )}
      </div>
      {(props.groupDescription || props.status !== undefined) &&
      (!!props.description || props.status !== undefined) ? (
        <div data-ui={`${kind}-subline`} data-kv-page-identity="subline">
          {!!props.description && (
            <p data-ui={`${kind}-description`} data-kv-page-identity="description">
              {props.description}
            </p>
          )}
          {props.status !== undefined && (
            <span data-ui={`${kind}-status`} data-kv-page-identity="status">
              {props.status}
            </span>
          )}
        </div>
      ) : (
        !!props.description && (
          <p data-ui={`${kind}-description`} data-kv-page-identity="description">
            {props.description}
          </p>
        )
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
    {props.context !== undefined && (
      <div data-ui={`${kind}-context`} data-kv-page-identity="context">
        {props.context}
      </div>
    )}
    <header data-ui={`${kind}-header`} data-kv-page-identity="header">
      {pageIdentityContent(kind, props)}
    </header>
  </>
)
