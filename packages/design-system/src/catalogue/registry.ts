import type { CatalogueMaturity, CatalogueState } from './groups.ts'

export type ComponentRegistration = {
  name: string
  owner: string
  source: string
  groupId: string
  specimenId: string
  maturity: CatalogueMaturity
  states: readonly CatalogueState[]
}

const states = ['default', 'responsive'] as const
const entry = (
  name: string,
  owner: string,
  source: string,
  groupId: string,
  specimenId: string,
  maturity: CatalogueMaturity = 'stable',
  componentStates: readonly CatalogueState[] = states,
): ComponentRegistration => ({
  name,
  owner,
  source,
  groupId,
  specimenId,
  maturity,
  states: componentStates,
})

export const componentRegistry: readonly ComponentRegistration[] = [
  entry('ActionGroup', 'Actions', 'primitives/actions', 'actions', 'button'),
  entry('Button', 'Actions', 'primitives/actions', 'actions', 'button', 'stable', [
    'default',
    'disabled',
    'loading',
  ]),
  entry('IconButton', 'Actions', 'primitives/actions', 'actions', 'action-sizes'),
  entry('LinkButton', 'Actions', 'primitives/actions', 'actions', 'button'),
  entry('Avatar', 'Status', 'primitives/status', 'status', 'identity'),
  entry('Badge', 'Status', 'primitives/status', 'status', 'badges'),
  entry('Code', 'Status', 'primitives/status', 'status', 'identity'),
  entry('CountBadge', 'Status', 'primitives/status', 'status', 'badges'),
  entry('Tag', 'Status', 'primitives/status', 'status', 'badges'),
  entry('EmptyState', 'Feedback', 'primitives/feedback', 'feedback', 'empty-loading', 'stable', [
    'empty',
    'responsive',
  ]),
  entry('LoadingState', 'Feedback', 'primitives/feedback', 'feedback', 'empty-loading', 'stable', [
    'loading',
    'responsive',
  ]),
  entry('Notice', 'Feedback', 'primitives/feedback', 'feedback', 'notice'),
  entry('Field', 'Forms', 'primitives/field', 'fields', 'field', 'stable', [
    'default',
    'disabled',
    'invalid',
    'responsive',
  ]),
  entry('NavItem', 'Navigation', 'primitives/navigation', 'navigation', 'navigation-items'),
  entry('NavList', 'Navigation', 'primitives/navigation', 'navigation', 'navigation-items'),
  entry('Tabs', 'Navigation', 'primitives/navigation', 'navigation', 'navigation-items'),
  entry('Progress', 'Feedback', 'primitives/progress', 'navigation', 'progress'),
  entry('Stack', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('Inline', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('Grid', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('Surface', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('Disclosure', 'Layout', 'layouts/layout', 'layouts', 'disclosure'),
  entry('Section', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('ContentCard', 'Layout', 'layouts/layout', 'layouts', 'content-card'),
  entry('Metric', 'Layout', 'layouts/layout', 'layouts', 'surface-section'),
  entry('AppShell', 'Shell', 'layouts/shell', 'application-structure', 'app-shell'),
  entry('Page', 'Shell', 'layouts/shell', 'application-structure', 'app-shell'),
  entry('PageHeader', 'Shell', 'layouts/shell', 'application-structure', 'app-shell'),
  entry('RecordCanvas', 'Shell', 'layouts/shell', 'application-structure', 'record-page'),
  entry('RecordSection', 'Shell', 'layouts/shell', 'application-structure', 'record-page'),
  entry('DataTable', 'Data display', 'patterns/data-table', 'patterns', 'data-table'),
  entry('BulkActions', 'Data operations', 'patterns/list-chrome', 'patterns', 'list-chrome'),
  entry('ListChrome', 'Data operations', 'patterns/list-chrome', 'patterns', 'list-chrome'),
  entry('PagerBar', 'Data operations', 'patterns/list-chrome', 'patterns', 'list-chrome'),
  entry('ListPage', 'Page patterns', 'patterns/list-page', 'application-structure', 'list-page'),
  entry('RecordPage', 'Page patterns', 'patterns/record-page', 'application-structure', 'record-page'),
  entry(
    'WorkspacePage',
    'Page patterns',
    'patterns/workspace-page',
    'application-structure',
    'workspace-flow',
  ),
  entry('FormPage', 'Page recipes', 'patterns/form-page', 'patterns', 'form-page', 'deprecated'),
  entry(
    'DashboardPage',
    'Page recipes',
    'patterns/dashboard-page',
    'patterns',
    'dashboard-page',
    'deprecated',
  ),
  entry('BoardPage', 'Page recipes', 'patterns/board-page', 'patterns', 'board-page', 'deprecated'),
  entry('ModalSheet', 'Overlays', 'patterns/modal-sheet', 'patterns', 'modal-sheet'),
  entry('Pipeline', 'Data display', 'patterns/pipeline', 'patterns', 'pipeline'),
  entry('RecordForm', 'Forms', 'patterns/record-form', 'patterns', 'record-form'),
  entry('Menu', 'Actions', 'interactions/menu', 'interactions', 'menu'),
  entry('ActionMenu', 'Actions', 'interactions/menu', 'interactions', 'menu'),
  entry('Popover', 'Overlays', 'interactions/popover', 'interactions', 'popover'),
  entry('Tooltip', 'Overlays', 'interactions/tooltip', 'interactions', 'popover'),
  entry('Dialog', 'Overlays', 'interactions/dialog', 'interactions', 'dialog'),
  entry('ConfirmDialog', 'Overlays', 'interactions/dialog', 'interactions', 'dialog'),
  entry('Toast', 'Feedback', 'interactions/toast', 'interactions', 'feedback-runtime'),
  entry('ToastRegion', 'Feedback', 'interactions/toast', 'interactions', 'feedback-runtime'),
  entry('Spinner', 'Feedback', 'interactions/spinner', 'interactions', 'feedback-runtime'),
  entry('Skeleton', 'Feedback', 'interactions/skeleton', 'interactions', 'feedback-runtime'),
]
