import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { workspacePage, type WorkspacePageProps } from './workspace-page.tsx'

export const HOOKS = [
  'dashboard-page',
  'dashboard-page-context',
  'dashboard-page-header',
  'dashboard-page-heading',
  'dashboard-page-eyebrow',
  'dashboard-page-title-row',
  'dashboard-page-title',
  'dashboard-page-subline',
  'dashboard-page-status',
  'dashboard-page-description',
  'dashboard-page-actions',
  'dashboard-page-meta',
  'dashboard-page-body',
] as const

export type DashboardPageProps = Omit<WorkspacePageProps, 'layout' | 'controls'>

/**
 * The baseline for KPI, workflow and analytical overview screens.
 *
 * Applications own the translated copy, business actions and dashboard blocks.
 * This pattern keeps location, identity and the overview canvas in a stable,
 * compact hierarchy without pretending that the dashboard is a business record.
 */
export const DashboardPage = (props: DashboardPageProps): TemplateResult =>
  workspacePage({ ...props, layout: 'flow' }, 'dashboard-page')
