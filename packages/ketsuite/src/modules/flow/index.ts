import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { flowJobs } from './jobs.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'flow',
  // 0.2.0 adds the backlog index; no data change, so the migration is the
  // index alone. 0.3.0 adds ProjectMember, which decides what anybody sees —
  // an empty table means an empty Flow until somebody is added to a project.
  // 0.4.0 adds ProjectDeletion and the purge job behind it: the record of a
  // deletion has to outlive the project, so it is a table rather than a flag.
  version: '0.4.0',
  depends: ['company', 'user', 'mail', 'storage'],
  title: 'Flow',
  summary: 'Projects, issues, sprints, and epics.',
  category: 'Productivity',
  models,
  functions,
  jobs: flowJobs,
  messages,
})

export {
  addComment,
  addDependency,
  FIELD_FILTER_MATCHES,
  assignSprint,
  closeSprint,
  groupIssues,
  issueDetail,
  listIssues,
  moveIssue,
  saveIssue,
  startSprint,
} from './operations.ts'
export type { FlowIssue, FlowResult, SaveIssueInput } from './operations.ts'
export { projectsWithMyWork, projectStats, projectStateOf } from './projects.ts'
export type { ProjectStats, ProjectState } from './projects.ts'
export {
  archivePage,
  listAllPages,
  listPages,
  movePage,
  pageDetail,
  reorderPage,
  restorePage,
  savePage,
} from './pages.ts'
export type { PageDetail, PageRow, SavePageInput } from './pages.ts'
export { issueListSearch, emptyIssueListState } from './search.ts'
export { DEPENDENCY_RELATIONS, ISSUE_PRIORITIES, SPRINT_STATES } from './types.ts'
export type { DependencyRelation, IssuePriority, SprintState } from './types.ts'
