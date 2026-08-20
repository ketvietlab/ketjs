import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Type: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      category: 'text',
      icon: 'text?',
      defaultDelayDays: 'int',
      chainingPolicy: 'text',
      nextTypeId: 'ref:activity.Type?',
      sequence: 'int',
      active: 'bool',
    },
    indexes: {
      active_sequence: { fields: ['companyId', 'active', 'sequence', 'name'] },
    },
  },

  Activity: {
    scope: 'company',
    fields: {
      id: 'id',
      threadId: 'ref:mail.Thread',
      typeId: 'ref:activity.Type',
      assigneeUserId: 'ref:user.User',
      createdByUserId: 'ref:user.User?',
      summary: 'text',
      note: 'text?',
      dueDate: 'date',
      active: 'bool',
      doneAt: 'datetime?',
      canceledAt: 'datetime?',
      feedback: 'text?',
      previousActivityId: 'ref:activity.Activity?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      assignee_due: { fields: ['companyId', 'assigneeUserId', 'active', 'dueDate'] },
      thread_due: { fields: ['companyId', 'threadId', 'active', 'dueDate'] },
      previous: { fields: ['companyId', 'previousActivityId'] },
    },
  },

  Attachment: {
    scope: 'company',
    fields: {
      id: 'id',
      activityId: 'ref:activity.Activity',
      attachmentId: 'ref:storage.Attachment',
    },
    indexes: {
      identity: { fields: ['companyId', 'activityId', 'attachmentId'], unique: true },
    },
  },

  Plan: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      description: 'text?',
      active: 'bool',
    },
    indexes: { active_name: { fields: ['companyId', 'active', 'name'] } },
  },

  PlanStep: {
    scope: 'company',
    fields: {
      id: 'id',
      planId: 'ref:activity.Plan',
      typeId: 'ref:activity.Type',
      offsetDays: 'int',
      assigneeStrategy: 'text',
      assigneeUserId: 'ref:user.User?',
      summary: 'text?',
      note: 'text?',
      sequence: 'int',
    },
    indexes: { plan_sequence: { fields: ['companyId', 'planId', 'sequence', 'id'] } },
  },
}
