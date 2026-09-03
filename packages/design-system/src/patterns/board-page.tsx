import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { workspacePage, type WorkspacePageProps } from './workspace-page.tsx'

export const HOOKS = [
  'board-page',
  'board-page-context',
  'board-page-header',
  'board-page-heading',
  'board-page-eyebrow',
  'board-page-title-row',
  'board-page-title',
  'board-page-subline',
  'board-page-status',
  'board-page-description',
  'board-page-actions',
  'board-page-meta',
  'board-page-toolbar',
  'board-page-controls',
  'board-page-body',
] as const

export type BoardPageProps = Omit<WorkspacePageProps, 'layout'>

/**
 * The baseline for kanban, schedule and timeline workspaces.
 *
 * A board needs more horizontal room than a collection or form, but it still
 * belongs to the same application hierarchy. The pattern keeps location,
 * identity and global controls in stable compact bands while leaving scrolling,
 * columns and interaction to the specialised board supplied by the application.
 */
export const BoardPage = (props: BoardPageProps): TemplateResult =>
  workspacePage({ ...props, layout: 'canvas' }, 'board-page')
