import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentity, type PageIdentityKind } from './page-shell.tsx'

export const HOOKS = [
  'workspace-page',
  'workspace-page-context',
  'workspace-page-header',
  'workspace-page-heading',
  'workspace-page-eyebrow',
  'workspace-page-title-row',
  'workspace-page-title',
  'workspace-page-subline',
  'workspace-page-status',
  'workspace-page-description',
  'workspace-page-actions',
  'workspace-page-meta',
  'workspace-page-toolbar',
  'workspace-page-controls',
  'workspace-page-body',
] as const

export type WorkspacePageProps = {
  title: string
  body: JSXChild
  context?: JSXChild
  variant?: 'operational'
  /** Vertical work surfaces use flow; boards, timelines and maps use canvas. */
  layout?: 'flow' | 'canvas'
  eyebrow?: string | null
  description?: string | null
  status?: JSXChild
  meta?: JSXChild
  actions?: JSXChild
  controls?: JSXChild
}

type CompatibilityKind = Extract<PageIdentityKind, 'dashboard-page' | 'board-page'>

export const workspacePage = (
  props: WorkspacePageProps,
  compatibilityKind?: CompatibilityKind,
): TemplateResult => {
  const kind = compatibilityKind ?? (props.layout === 'canvas' ? 'board-page' : 'dashboard-page')
  return (
    <section
      data-ui={kind}
      data-variant={props.variant ?? null}
      data-layout={props.layout ?? 'flow'}
      data-pattern="workspace"
    >
      {pageIdentity(kind, props)}
      {props.controls !== undefined && (
        <div data-ui={`${kind}-toolbar`}>
          <div data-ui={`${kind}-controls`}>{props.controls}</div>
        </div>
      )}
      <div data-ui={`${kind}-body`}>{props.body}</div>
    </section>
  )
}

/** One operational canvas, with flow and horizontal-canvas layout modes. */
export const WorkspacePage = (props: WorkspacePageProps): TemplateResult => workspacePage(props)
