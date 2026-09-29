import { tr } from './i18n.mjs'
export function auditChange(change, data) {
  const labels = {
    title: 'title',
    status: 'status',
    dueDate: 'due.date',
    startDate: 'start.date',
    assignee: 'assignee.02be53',
    assigneeIds: 'assignee.02be53',
    priority: 'priority',
    sprint: 'sprint',
    epic: 'epic',
    blockedBy: 'dependencies',
    description: 'description',
    descriptionDoc: 'description',
    customFields: 'custom.fields',
    tags: 'labels',
    points: 'work.volume',
    visibility: 'visibility',
    readerIds: 'member',
    archived: 'archive',
    parentId: 'parent.document',
    liveDoc: 'content',
    content: 'content',
  }
  const label = labels[change.field] ? tr('flow.ui.' + labels[change.field]) : change.field
  if (['liveDoc', 'content', 'description', 'descriptionDoc'].includes(change.field))
    return tr('flow.review.updated', [label])
  const value = (v) => {
    if (v == null || v === '') return '—'
    if (Array.isArray(v)) return v.map(value).join(', ')
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 120)
    return (
      data.members?.find((m) => m.id === v)?.name ??
      data.columns?.find((c) => c.id === v)?.label ??
      data.epics?.find((e) => e.id === v)?.title ??
      String(v)
    )
  }
  return `${label}: ${value(change.before)} → ${value(change.after)}`
}
