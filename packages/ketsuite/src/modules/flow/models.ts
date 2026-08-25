import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Project: {
    scope: 'company',
    fields: {
      id: 'id',
      key: 'text',
      name: 'text',
      description: 'text?',
      active: 'bool',
    },
    indexes: {
      key: { fields: ['companyId', 'key'], unique: true },
      active_name: { fields: ['companyId', 'active', 'name'] },
    },
  },

  /**
   * Kanban status, dynamic per project.
   *
   * Unlike priority or dependency relation, a workflow is not a taxonomy the
   * industry has already settled: one team's process is "To Do / Doing / Done",
   * another's is five columns wide with a review gate. `terminalState` is what
   * lets an Epic's or Sprint's completion be computed without the code knowing
   * any column's name — it asks "is this the done state", not "is this called
   * Done".
   */
  Column: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      code: 'text',
      name: 'text',
      sequence: 'int',
      terminalState: 'bool',
      active: 'bool',
    },
    indexes: {
      code: { fields: ['companyId', 'projectId', 'code'], unique: true },
      board: { fields: ['companyId', 'projectId', 'active', 'sequence'] },
    },
  },

  /**
   * What kind of work an issue is: Bug, Story, Task.
   *
   * Dynamic per project like Column, not a fixed list like priority. A support
   * desk's vocabulary is Ticket and Question; a product team's is Story, Bug
   * and Spike; neither would recognise the other's. The test is the same one
   * Column passes and Sprint fails: nothing in this module branches on a
   * type's name, so there is nothing for the code to be wrong about when a
   * team renames one.
   */
  IssueType: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      code: 'text',
      name: 'text',
      color: 'text?',
      sequence: 'int',
      active: 'bool',
    },
    indexes: {
      code: { fields: ['companyId', 'projectId', 'code'], unique: true },
      project: { fields: ['companyId', 'projectId', 'active', 'sequence'] },
    },
  },

  Epic: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      title: 'text',
      color: 'text?',
      active: 'bool',
    },
    indexes: {
      project_active: { fields: ['companyId', 'projectId', 'active'] },
    },
  },

  /**
   * A fixed three-state machine, not a taxonomy teams customize: exactly one
   * sprint is ever `active` for a project (enforced in operations.ts, not by a
   * unique index — SQLite has no partial-unique support this build depends on),
   * and a `closed` sprint stops accepting issues. Code branches on these values,
   * which is the line that separates this from Column.
   */
  Sprint: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      name: 'text',
      startDate: 'date?',
      endDate: 'date?',
      state: 'text',
    },
    indexes: {
      project_state: { fields: ['companyId', 'projectId', 'state'] },
    },
  },

  Issue: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      columnId: 'ref:flow.Column',
      typeId: 'ref:flow.IssueType?',
      epicId: 'ref:flow.Epic?',
      sprintId: 'ref:flow.Sprint?',
      /** A sub-task. Self-referencing, the same shape as `crm.Case.mergedIntoId`. */
      parentIssueId: 'ref:flow.Issue?',
      title: 'text',
      assigneeUserId: 'ref:user.User?',
      priority: 'text',
      dueDate: 'date?',
      /** Story points or hours; the unit is a team convention, not a schema one. */
      estimate: 'decimal?',
      /** Comments, followers, and notifications all live on this thread — see mail. */
      threadId: 'ref:mail.Thread',
      /**
       * The rich description is a Yjs (CRDT) document, not a field this row's own
       * `version`/compareAndSet guards — one row cannot honestly carry two
       * consistency models under one counter. These three columns are written
       * only by the flatten routine in flow_backend/sync.ts, as a plain column
       * update outside the CAS path, never by `issue.save`.
       */
      previewText: 'text?',
      contentAttachmentId: 'ref:storage.Attachment?',
      contentUpdatedAt: 'datetime?',
      active: 'bool',
      version: 'int',
      createdByUserId: 'ref:user.User?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      board: { fields: ['companyId', 'projectId', 'active', 'columnId', 'priority'] },
      assignee: { fields: ['companyId', 'assigneeUserId', 'active', 'updatedAt'] },
      sprint: { fields: ['companyId', 'sprintId', 'active'] },
      epic: { fields: ['companyId', 'epicId', 'active'] },
      parent: { fields: ['companyId', 'parentIssueId'] },
    },
  },

  /**
   * `blocks` and `related` are the two relations an issue tracker's own logic
   * reads — a `blocks` dependency that is not done keeps the blocked issue out of
   * a terminal column. Neither is a name a team would want to change; that is
   * what makes them a fixed pair rather than a table like Tag.
   */
  IssueDependency: {
    scope: 'company',
    fields: {
      id: 'id',
      issueId: 'ref:flow.Issue',
      dependsOnIssueId: 'ref:flow.Issue',
      relation: 'text',
    },
    indexes: {
      identity: { fields: ['companyId', 'issueId', 'dependsOnIssueId', 'relation'], unique: true },
      dependents: { fields: ['companyId', 'dependsOnIssueId'] },
    },
  },

  Tag: {
    scope: 'company',
    fields: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    indexes: { name: { fields: ['companyId', 'name'], unique: true } },
  },

  IssueTag: {
    scope: 'company',
    fields: { id: 'id', issueId: 'ref:flow.Issue', tagId: 'ref:flow.Tag' },
    indexes: { identity: { fields: ['companyId', 'issueId', 'tagId'], unique: true } },
  },
}
