import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type PageIdentityKind =
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

/**
 * The single identity band shared by every full-page pattern.
 *
 * The pattern name remains in each hook so consumers can style the content
 * contract without reimplementing breadcrumbs, title hierarchy or actions.
 */
export const pageIdentityContent = (
  kind: PageIdentityKind,
  props: PageIdentityContentProps,
): TemplateResult => (
  <>
    <div data-ui={`${kind}-heading`}>
      {!!props.eyebrow && <p data-ui={`${kind}-eyebrow`}>{props.eyebrow}</p>}
      <div data-ui={`${kind}-title-row`}>
        <h1 data-ui={`${kind}-title`}>{props.title}</h1>
        {props.actions !== undefined && <div data-ui={`${kind}-actions`}>{props.actions}</div>}
      </div>
      {(props.groupDescription || props.status !== undefined) &&
      (!!props.description || props.status !== undefined) ? (
        <div data-ui={`${kind}-subline`}>
          {!!props.description && <p data-ui={`${kind}-description`}>{props.description}</p>}
          {props.status !== undefined && <span data-ui={`${kind}-status`}>{props.status}</span>}
        </div>
      ) : (
        !!props.description && <p data-ui={`${kind}-description`}>{props.description}</p>
      )}
    </div>
    {props.meta !== undefined && <div data-ui={`${kind}-meta`}>{props.meta}</div>}
  </>
)

export const pageIdentity = (kind: PageIdentityKind, props: PageIdentityProps): TemplateResult => (
  <>
    {props.context !== undefined && <div data-ui={`${kind}-context`}>{props.context}</div>}
    <header data-ui={`${kind}-header`}>{pageIdentityContent(kind, props)}</header>
  </>
)
