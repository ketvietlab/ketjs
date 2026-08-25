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

  /**
   * A field a project adds to its own issues: Environment, Version, Component.
   *
   * One mechanism instead of three hardcoded taxonomies. Each of those would
   * have been a model, a settings screen and a column on Issue, and the fourth
   * request would have needed a fourth. What a team wants to record about its
   * work is not something this module can finish guessing.
   *
   * `config` holds what only some kinds need — the options of a `select`. It
   * is json because those options are edited as a unit and nothing joins to
   * them; a separate table would buy referential integrity over a list whose
   * whole purpose is to be rewritten.
   */
  FieldDef: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      code: 'text',
      name: 'text',
      /** One of FIELD_KINDS. Says how `IssueFieldValue.value` is to be read. */
      kind: 'text',
      config: 'json?',
      sequence: 'int',
      active: 'bool',
    },
    indexes: {
      code: { fields: ['companyId', 'projectId', 'code'], unique: true },
      project: { fields: ['companyId', 'projectId', 'active', 'sequence'] },
    },
  },

  /**
   * What one issue holds for one of those fields.
   *
   * Always text, whatever the kind says, because the alternative is a column
   * per type and a reader that has to know which one to look in — it would
   * know that from `kind` either way, so the extra columns buy nothing.
   *
   * The `lookup` index is the filter path. The query builder has no JOIN, so
   * "every issue whose Environment is Production" is answered the way this
   * codebase answers every cross-table question: select the matching values
   * here, then `inArray` those issue ids on the issue query.
   */
  IssueFieldValue: {
    scope: 'company',
    fields: {
      id: 'id',
      issueId: 'ref:flow.Issue',
      fieldId: 'ref:flow.FieldDef',
      value: 'text?',
    },
    indexes: {
      identity: { fields: ['companyId', 'issueId', 'fieldId'], unique: true },
      lookup: { fields: ['companyId', 'fieldId', 'value'] },
    },
  },

  /**
   * Which project a reader's board is looking at.
   *
   * A board has to be one project's: `Column` belongs to a project by design,
   * so a board spanning them has nothing to group by. The route is global, the
   * scope is per person, and this is where that scope lives.
   *
   * Flow's own model rather than a preference store for the whole suite.
   * Nothing here has one, and inventing one as a side effect of a board would
   * be deciding on every other module's behalf how they keep per-user state.
   * When a second module needs it, that is the moment to lift it — not this
   * one.
   */
  BoardScope: {
    scope: 'company',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      projectId: 'ref:flow.Project',
      updatedAt: 'datetime',
    },
    indexes: {
      reader: { fields: ['companyId', 'userId'], unique: true },
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
      /**
       * When work is meant to start. Optional, and usually absent: most issues
       * are written down without anybody deciding a start date, and a Gantt
       * chart still has to draw them. `serializeIssueList` answers that with
       * `startsOn`, which falls back to the day the issue was created — a
       * separate field, so a bar can be drawn without the fallback being
       * written back as though somebody had chosen it.
       */
      startDate: 'date?',
      dueDate: 'date?',
      /** Story points or hours; the unit is a team convention, not a schema one. */
      estimate: 'decimal?',
      /** Comments, followers, and notifications all live on this thread — see mail. */
      threadId: 'ref:mail.Thread',
      /**
       * The rich description is a Yjs (CRDT) document, not a field this row's own
       * `version`/compareAndSet guards — one row cannot honestly carry two
       * consistency models under one counter. These three columns are written
       * only by Live Doc's flatten routine (modules/livedoc), as a plain column
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
