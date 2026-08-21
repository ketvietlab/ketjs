import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'activity.Type': {
    nextType: { belongsTo: 'activity.Type', by: 'nextTypeId' },
    activities: { hasMany: 'activity.Activity', by: 'typeId' },
  },
  'activity.Activity': {
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    type: { belongsTo: 'activity.Type', by: 'typeId' },
    assignee: { belongsTo: 'user.User', by: 'assigneeUserId' },
    attachments: { hasMany: 'activity.Attachment', by: 'activityId' },
    previous: { belongsTo: 'activity.Activity', by: 'previousActivityId' },
  },
  'activity.Attachment': {
    activity: { belongsTo: 'activity.Activity', by: 'activityId' },
    attachment: { belongsTo: 'storage.Attachment', by: 'attachmentId' },
  },
  'activity.Plan': { steps: { hasMany: 'activity.PlanStep', by: 'planId' } },
  'activity.PlanStep': {
    plan: { belongsTo: 'activity.Plan', by: 'planId' },
    type: { belongsTo: 'activity.Type', by: 'typeId' },
    assignee: { belongsTo: 'user.User', by: 'assigneeUserId' },
  },
}
