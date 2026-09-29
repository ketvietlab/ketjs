import { isDone } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { taskAssigneeIds } from '@ketvietlab/flow-client/task-assignees.mjs'
export function captureProduct(data) {
  return structuredClone({ tasks: data.tasks, pages: data.pages })
}
export function recordProductChanges(data, before) {
  const now = new Date().toISOString(),
    fields = [
      'title',
      'status',
      'dueDate',
      'startDate',
      'assigneeIds',
      'assignee',
      'priority',
      'sprint',
      'epic',
      'blockedBy',
      'description',
      'descriptionDoc',
      'customFields',
      'tags',
      'points',
    ]
  const notify = (task, kind, needed, recipients) => {
    for (const recipientId of recipients)
      data.inbox.unshift({
        id: crypto.randomUUID(),
        taskId: task.id,
        actorId: data.user.id,
        recipientId,
        titleKey: 'flow.review.' + kind,
        description: task.title,
        kind,
        actionNeeded: needed,
        read: false,
        route: 'issue',
        createdAt: now,
      })
  }
  for (const task of data.tasks) {
    const old = before.tasks.find((t) => t.id === task.id),
      changes = fields
        .filter((k) => JSON.stringify(old?.[k]) !== JSON.stringify(task[k]))
        .map((field) => ({ field, before: old?.[field] ?? null, after: task[field] ?? null }))
    if (!changes.length) continue
    data.history = data.history.filter((h) => h.taskId !== task.id || h.time !== 'Vừa xong')
    const entry = {
      id: crypto.randomUUID(),
      taskId: task.id,
      actorId: data.user.id,
      person: data.user.name,
      time: now,
      version: task.version,
      changes,
      messageKey: 'flow.review.taskUpdated',
      messageValues: [task.version],
      text: changes
        .map(
          (c) =>
            c.field +
            ': ' +
            (Array.isArray(c.after)
              ? c.after.map((id) => data.members.find((m) => m.id === id)?.name ?? id).join(', ')
              : String(c.after ?? '')),
        )
        .join(' · '),
    }
    data.history.unshift(entry)
    const blocked = (t, all) =>
      t?.blockedBy?.some(
        (id) =>
          !isDone(
            data,
            all.find((x) => x.id === id),
          ),
      ) ?? false
    if (blocked(old, before.tasks) !== blocked(task, data.tasks))
      notify(task, blocked(task, data.tasks) ? 'blocked' : 'unblocked', true, taskAssigneeIds(data, task))
  }
  // Dependency state can change without editing the dependent task itself.
  for (const task of data.tasks) {
    const old = before.tasks.find((t) => t.id === task.id)
    if (!old || JSON.stringify(old) !== JSON.stringify(task)) continue
    const blocked = (t, all) =>
      t.blockedBy?.some(
        (id) =>
          !isDone(
            data,
            all.find((x) => x.id === id),
          ),
      ) ?? false
    if (blocked(old, before.tasks) !== blocked(task, data.tasks))
      notify(task, blocked(task, data.tasks) ? 'blocked' : 'unblocked', true, taskAssigneeIds(data, task))
  }
  for (const page of data.pages) {
    const old = before.pages.find((p) => p.id === page.id)
    if (JSON.stringify({ ...old, history: undefined }) === JSON.stringify({ ...page, history: undefined }))
      continue
    page.version = (old?.version ?? 0) + 1
    page.history = [
      ...(old?.history ?? []),
      {
        id: crypto.randomUUID(),
        person: data.user.name,
        time: now,
        version: page.version,
        changes: ['title', 'visibility', 'readerIds', 'archived', 'parentId', 'liveDoc', 'content']
          .filter((k) => JSON.stringify(old?.[k]) !== JSON.stringify(page[k]))
          .map((field) => ({ field, before: old?.[field] ?? null, after: page[field] ?? null })),
      },
    ]
  }
  for (const n of data.inbox)
    if (
      n.kind === 'blocked' &&
      !data.tasks
        .find((t) => t.id === n.taskId)
        ?.blockedBy?.some(
          (id) =>
            !isDone(
              data,
              data.tasks.find((t) => t.id === id),
            ),
        )
    )
      n.actionNeeded = false
  for (const n of data.inbox)
    if (
      (n.kind === 'assignment' ||
        (n.kind === 'unblocked' &&
          before.tasks.find((t) => t.id === n.taskId)?.status !==
            data.tasks.find((t) => t.id === n.taskId)?.status)) &&
      ['progress', 'review', 'done'].includes(
        data.columns.find((c) => c.id === data.tasks.find((t) => t.id === n.taskId)?.status)?.kind,
      )
    )
      n.actionNeeded = false
}
