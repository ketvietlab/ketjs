import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { WorkspacePage, type WorkspacePageProps } from './workspace-page.tsx'

export type BoardPageProps = Omit<WorkspacePageProps, 'layout'>

/** @deprecated Use WorkspacePage with layout="canvas". */
export const BoardPage = (props: BoardPageProps): TemplateResult =>
  WorkspacePage({ ...props, layout: 'canvas' } as WorkspacePageProps)
