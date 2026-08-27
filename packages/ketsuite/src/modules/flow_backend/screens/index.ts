// One screen per file; this is the surface routes.ts and islands.ts import.
//
// The file these came out of had grown past a thousand lines and eleven
// screens, which is the point at which finding one means scrolling rather
// than opening.
export { projectNav } from './nav.tsx'
export { projectsListScreen } from './projects-list.tsx'
export type { ProjectsOverview } from './projects-list.tsx'
export { projectCreateModal, projectCreateScreen, TEMPLATE_OPTIONS } from './project-create.tsx'
export type { ProjectCreateScreenOptions } from './project-create.tsx'
export { boardScreen } from './board.tsx'
export { ganttScreen } from './gantt.tsx'
export { mapScreen } from './map.tsx'
export { issueCreateModal, issuesScreen } from './issues.tsx'
export { crossProjectScreen } from './my-work.tsx'
export { issueDetailScreen } from './issue-detail.tsx'
export type { IssueDetailControls } from './issue-detail.tsx'
export { pagesScreen, projectPageCreateFields } from './project-pages.tsx'
export type { ProjectPageCreateValues, ProjectPagesScreenOptions } from './project-pages.tsx'
export { allPagesScreen } from './all-pages.tsx'
export type { AllPagesScreenOptions } from './all-pages.tsx'
export { pageDetailScreen } from './page-detail.tsx'
export type { PageDetailAction, PageDetailScreenOptions } from './page-detail.tsx'
export { epicsScreen, projectEpicCreateFields } from './project-epics.tsx'
export type {
  ProjectEpicCreateValues,
  ProjectEpicsScreenOptions,
} from './project-epics.tsx'
export { allEpicsScreen } from './all-epics.tsx'
export type { AllEpicsScreenOptions } from './all-epics.tsx'
export { epicDetailScreen } from './epic-detail.tsx'
export type { EpicDetailScreenOptions } from './epic-detail.tsx'
export { sprintsScreen } from './sprints.tsx'
export { settingsScreen } from './settings.tsx'
