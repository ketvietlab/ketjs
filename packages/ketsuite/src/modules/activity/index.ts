import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'activity',
  group: 'system',
  version: '0.1.0',
  depends: ['mail', 'user', 'storage'],
  app: true,
  title: 'Hoạt động',
  summary: 'Việc cần làm, hạn xử lý, kế hoạch và chuỗi hoạt động trên bản ghi.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Hoạt động',
      'app.summary': 'Việc cần làm, hạn xử lý, kế hoạch và chuỗi hoạt động trên bản ghi.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Activities',
      'app.summary': 'Record tasks, deadlines, plans and chained follow-ups.',
      'app.category': 'Productivity',
    },
  },
})

export { functions } from './functions.ts'
export {
  actorId,
  addDays,
  cancelActivity,
  completeActivity,
  listTypes,
  rescheduleActivity,
  scheduleActivity,
  stateOf,
} from './operations.ts'
export type { CompleteActivityResult, ScheduleActivityInput } from './operations.ts'
export { targetActivityFunctions } from './target.ts'
export {
  ACTIVITY_CATEGORIES,
  ACTIVITY_STATES,
  ASSIGNEE_STRATEGIES,
  CHAINING_POLICIES,
} from './types.ts'
export type { ActivityCategory, ActivityState, AssigneeStrategy, ChainingPolicy } from './types.ts'
