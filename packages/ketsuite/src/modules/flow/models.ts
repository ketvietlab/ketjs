import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Project: {
    scope: 'company',
    fields: {
      id: 'id',
      key: 'text',
      name: 'text',
      /**
       * The one line that identifies the project in a list — kept as a plain
       * column beside the brief below, not replaced by it. A list row wants a
       * sentence, and rendering one out of a CRDT to draw a table would be a
       * document read per row.
       */
      description: 'text?',
      /** The project brief, as a Live Doc. Written only by its flatten routine. */
      previewText: 'text?',
      contentAttachmentId: 'ref:storage.Attachment?',
      contentUpdatedAt: 'datetime?',
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
   * Who is on a project.
   *
   * The one thing that decides what a person sees. A permission bundle answers
   * *what* somebody may do — read, work, write documents, configure — and this
   * answers *which projects they may do it to*. Both have to be true, and they
   * are separate questions: a project administrator is not automatically on
   * every project, and being on a project does not make you able to reconfigure
   * it (FLW-DEC-012, FLW-DEC-008).
   *
   * There is deliberately no role column. A second authority axis inside the
   * project would have to be intersected with the bundles at every call site,
   * which is a second place to get it wrong; if per-project roles are ever
   * needed they are their own decision, not a field added quietly here.
   *
   * A project with no rows here is visible to nobody. Closed is the only safe
   * default for a model whose whole purpose is to keep some projects unread.
   */
  ProjectMember: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      userId: 'ref:user.User',
      /** When they joined, so a members list can be ordered by something real. */
      addedAt: 'datetime',
      addedByUserId: 'ref:user.User?',
    },
    indexes: {
      // One row per person per project: adding somebody twice is the same fact.
      member: { fields: ['companyId', 'projectId', 'userId'], unique: true },
      // The hot read: every list screen starts from "which projects are mine".
      mine: { fields: ['companyId', 'userId'] },
    },
  },

  /**
   * One person who reads every project in the company.
   *
   * The business-manager alternative to making somebody a technical superuser,
   * and the same device `crm.AccessGrant` is. It exists so that membership can
   * be administered by somebody who is not first a member of everything, and so
   * that a project whose members have all left is not unreachable.
   *
   * A row, not a permission bundle: a domain function cannot ask the kernel what
   * the caller may call, and a company-wide reach ought to be visible as data
   * that somebody can list, grant and revoke.
   */
  ProjectAccessGrant: {
    scope: 'company',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      addedAt: 'datetime',
      addedByUserId: 'ref:user.User?',
    },
    indexes: {
      holder: { fields: ['companyId', 'userId'], unique: true },
    },
  },

  /**
   * A project somebody asked to have deleted, and what became of the request.
   *
   * Archiving is the default and stays the default; this is the other thing —
   * the project and everything in it removed for good, blobs included, because
   * somebody asked for the data to be gone rather than hidden (FLW-DEC-018).
   *
   * Written **before** anything is deleted. A record that appears only on
   * success is not an audit trail: the interesting case is the deletion that
   * ran halfway, and that is exactly the case a success-only record misses.
   *
   * `projectId` is plain text rather than `ref:flow.Project`. It has to be:
   * the row it names is what this row exists to remember, and a reference to a
   * deleted project is a reference to nothing. The key and name are copied for
   * the same reason — after the purge there is nowhere left to read them from,
   * and "project 7f3a-… was deleted" answers nobody's question.
   */
  ProjectDeletion: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'text',
      projectKey: 'text',
      projectName: 'text',
      requestedAt: 'datetime',
      requestedByUserId: 'ref:user.User?',
      reason: 'text?',
      /** `requested` until the queue finishes, then `done`. */
      state: 'text',
      completedAt: 'datetime?',
      /** What went, by table, so the record says more than "it ran". */
      removed: 'json?',
    },
    indexes: {
      target: { fields: ['companyId', 'projectId'] },
      pending: { fields: ['companyId', 'state', 'requestedAt'] },
    },
  },

  /**
   * A row to contend on, so two people cannot start a sprint at the same time.
   *
   * "A project runs one active sprint" spans rows, so no single-row constraint
   * can express it, and the model DSL has no partial unique index to hand it
   * to the database with. Read-then-write inside a transaction is enough on
   * SQLite, where writers are serialized, and is not enough on PostgreSQL at
   * READ COMMITTED: two transactions each read zero active sprints and each
   * write one, and the project ends up with two — which means it has none,
   * because every screen asking for "the" current sprint gets whichever the
   * query happened to order first.
   *
   * So the invariant is given something to serialize on. Both transactions
   * update this row first and the second one waits; when it goes on, its next
   * statement takes a fresh snapshot and sees what the first one did. The same
   * device `user.SecurityGuard` uses, for the same reason (FLW-019).
   */
  ProjectGuard: {
    scope: 'company',
    fields: { id: 'id', projectId: 'ref:flow.Project', updatedAt: 'datetime' },
    indexes: { project: { fields: ['companyId', 'projectId'], unique: true } },
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
      /** What the epic is actually for, as a Live Doc — see the note on Issue. */
      previewText: 'text?',
      contentAttachmentId: 'ref:storage.Attachment?',
      contentUpdatedAt: 'datetime?',
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
      /**
       * The backlog's own read: one project, live issues, newest first — which
       * is `emptyIssueListState`'s default sort and therefore the query every
       * project list screen runs before anyone touches a filter.
       *
       * `board` covers the same first three columns but continues into
       * `columnId`, so the sort had to happen outside the index; `assignee`
       * ends in `updatedAt` but starts from the person, which answers "my work"
       * and not "this project's".
       */
      backlog: { fields: ['companyId', 'projectId', 'active', 'updatedAt'] },
      assignee: { fields: ['companyId', 'assigneeUserId', 'active', 'updatedAt'] },
      sprint: { fields: ['companyId', 'sprintId', 'active'] },
      epic: { fields: ['companyId', 'epicId', 'active'] },
      parent: { fields: ['companyId', 'parentIssueId'] },
    },
  },

  /**
   * A written document that belongs to a project rather than to a task.
   *
   * The rich text is the whole point here, which is the difference from
   * `Issue`: an issue is a row with a description attached, a page is a
   * document with a title on it. So the same three Live Doc columns appear,
   * and almost nothing else does — no assignee, no state, no due date. A page
   * that needs those is an issue.
   *
   * `parentPageId` gives the tree a wiki grows into. Self-referencing, the
   * same shape `Issue.parentIssueId` already uses; depth is not bounded by the
   * schema because the query builder has no recursive CTE to walk it with, so
   * the screen reads one level at a time.
   */
  Page: {
    scope: 'company',
    fields: {
      id: 'id',
      projectId: 'ref:flow.Project',
      parentPageId: 'ref:flow.Page?',
      title: 'text',
      /**
       * Written only by Live Doc's flatten routine (modules/livedoc), as a
       * plain column update outside the CAS path — the same arrangement, and
       * the same reason, as `Issue`'s three columns above: a Yjs document and
       * a `version` counter are two consistency models, and one row cannot
       * honestly carry both under one number.
       */
      previewText: 'text?',
      contentAttachmentId: 'ref:storage.Attachment?',
      contentUpdatedAt: 'datetime?',
      /** Ordering among siblings, stepped by 10 the way Column does. */
      sequence: 'int',
      active: 'bool',
      version: 'int',
      createdByUserId: 'ref:user.User?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      project_active: { fields: ['companyId', 'projectId', 'active', 'sequence'] },
      parent: { fields: ['companyId', 'parentPageId'] },
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
