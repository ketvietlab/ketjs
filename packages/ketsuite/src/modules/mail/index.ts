import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'mail',
  version: '0.1.0',
  depends: ['partner', 'user', 'storage'],
  app: true,
  title: 'Thảo luận',
  summary: 'Chatter, người theo dõi và hộp thư thông báo nội bộ.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  messages,
})

export {
  ensureThread,
  followThread,
  listFollowers,
  listTimeline,
  postMessage,
  unfollowThread,
  unreadNotifications,
} from './operations.ts'
export type {
  EnsureThreadInput,
  FollowInput,
  PostMessageInput,
  PostMessageResult,
  TrackingInput,
} from './operations.ts'
export { MESSAGE_KINDS, NOTIFICATION_CHANNELS, NOTIFICATION_STATES } from './types.ts'
export type { MessageKind, NotificationChannel, NotificationState } from './types.ts'
export { targetFunctions } from './target.ts'
export type { CollaborationTarget, TargetBridge } from './target.ts'
