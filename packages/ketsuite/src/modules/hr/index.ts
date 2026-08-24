import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'hr',
  group: 'system',
  version: '0.1.0',
  depends: ['company', 'partner', 'user'],
  app: true,
  title: 'Nhân sự',
  summary: 'Nhân viên, ca xoay và nghỉ phép.',
  category: 'Nhân sự',
  models,
  relations,
  functions,
  messages,
})

export {
  LEAVE_PORTIONS,
  LEAVE_STATES,
  ROSTER_STATES,
  SHIFT_STATES,
} from './types.ts'
export type { LeavePortion, LeaveState, RosterState, ShiftState } from './types.ts'
