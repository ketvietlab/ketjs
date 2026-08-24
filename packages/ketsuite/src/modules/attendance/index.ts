import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'attendance',
  version: '0.1.0',
  depends: ['hr', 'channel_api'],
  compatible: { channel_api: '^1' },
  title: 'Chấm công',
  summary: 'Kiosk, nhật ký công và chốt kỳ tháng.',
  category: 'Nhân sự',
  models,
  relations,
  functions,
  routes: channelRoutes,
  messages,
})

export { PERIOD_STATES, PUNCH_KINDS, PUNCH_SOURCES, REQUEST_STATES } from './types.ts'
export type { PeriodState, PunchKind, PunchSource, RequestState } from './types.ts'
