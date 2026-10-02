import { managementTabs } from './navigation.mjs'

// Two bounded widths; boards, calendar/timeline and document editors are explicitly unbounded work surfaces.
// Other neighboring tabs retain stable edges. Dialogs retain their background.
const groups = {
  full: ['board', 'calendar', 'pages', 'page', 'page-archived'],
  standard: ['inbox', 'personal-settings', 'team', ...managementTabs.company.map((tab) => tab.value)],
  wide: [
    ...managementTabs.workspace.map((tab) => tab.value),
    'projects',
    'dashboard',
    'my-work',
    'issue-filter',
    'all-epics',
    'tags',
    'project-issues',
    'sprints',
    'sprint-report',
    'epics',
    'epic',
    'atlas',
    'settings',
    'project-profile',
    'project-members',
    'github',
    'forms',
    'saved-views',
    'issues-archived',
    'filter-limit',
    'bulk',
  ],
}
export const contentWidths = Object.fromEntries(
  Object.entries(groups).flatMap(([width, keys]) => keys.map((key) => [key, width])),
)
/** Extension routes carry their own width. */
export const contentWidthFor = (key, route) => route?.width ?? contentWidths[key] ?? 'standard'
