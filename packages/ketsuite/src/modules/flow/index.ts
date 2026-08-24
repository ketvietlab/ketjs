import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'flow',
  version: '0.1.0',
  depends: ['company', 'user', 'mail', 'storage'],
  title: 'Flow',
  summary: 'Projects, issues, sprints, and epics.',
  category: 'Productivity',
  models,
  functions,
  messages,
})

export {
  addComment,
  addDependency,
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
export { issueListSearch, emptyIssueListState } from './search.ts'
export { DEPENDENCY_RELATIONS, ISSUE_PRIORITIES, SPRINT_STATES } from './types.ts'
export type { DependencyRelation, IssuePriority, SprintState } from './types.ts'
