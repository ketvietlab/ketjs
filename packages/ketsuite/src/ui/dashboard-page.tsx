import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { WorkspacePage, type WorkspacePageProps } from './workspace-page.tsx'

export type DashboardPageProps = Omit<WorkspacePageProps, 'layout' | 'controls'>

/** @deprecated Use WorkspacePage with layout="flow". */
export const DashboardPage = (props: DashboardPageProps): TemplateResult =>
  WorkspacePage({ ...props, layout: 'flow' } as WorkspacePageProps)
