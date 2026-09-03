import {
  WorkspacePage as DesignSystemWorkspacePage,
  type WorkspacePageProps as DesignSystemWorkspacePageProps,
} from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { pageContextFromFrame } from './navigation.tsx'

type WorkspacePageFrame = Pick<Frame, 'menu' | 'viewer' | 'extras'>

type ContextSource =
  | { frame: WorkspacePageFrame; context?: never }
  | { frame?: WorkspacePageFrame; context: Exclude<JSXChild, undefined> }

export type WorkspacePageProps = Omit<DesignSystemWorkspacePageProps, 'context'> & ContextSource

/** The sole KetSuite contract for vertical workspaces and horizontal canvases. */
export const WorkspacePage = (props: WorkspacePageProps): TemplateResult => {
  const extensionActions = props.frame?.extras?.['topbar.end']
  const actions =
    extensionActions !== undefined || props.actions !== undefined ? (
      <>
        {props.actions ?? ''}
        {extensionActions ?? ''}
      </>
    ) : undefined

  if (props.context !== undefined) {
    const { frame: _frame, context, ...page } = props
    return <DesignSystemWorkspacePage {...page} actions={actions} context={context} />
  }

  const { frame, context: _context, ...page } = props
  return (
    <DesignSystemWorkspacePage
      {...page}
      actions={actions}
      context={pageContextFromFrame(props.title, frame)}
    />
  )
}
