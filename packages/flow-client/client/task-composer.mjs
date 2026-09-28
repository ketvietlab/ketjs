import { tr } from './i18n.mjs'
import { assignableUsers } from './task-assignees.mjs'
import { usesSprints } from './sprint-cadence.mjs'
import { taskColumns, taskTags, statusForKind } from './project-catalogs.mjs'
import { html, signal } from '@ketvietlab/ketjs-view'
import { FlowInput, FlowTag, FlowLiveDoc, FlowLiveDocText } from '@ketvietlab/flow-ui'
import {
  FlowUserPicker,
  FlowTagPicker,
  FlowDisclosure,
  FlowRecordLayout,
  FlowPropertyFields,
  FlowSection,
  FlowStack,
  FlowInline,
  FlowTextarea,
  FlowSelectField,
  FlowNotice,
} from '@ketvietlab/flow-ui/workspace'
const lines = (value) =>
  String(value ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
export function taskCreatePayload(values, { parentId = null, files = [] } = {}) {
  return {
    ...values,
    points: Number(values.points) || 0,
    tags: [...new Set(Array.isArray(values.tags) ? values.tags : [])],
    checklist: lines(values.checklist).map((text, i) => ({
      id: `check-${i}`,
      text,
      checked: false,
    })),
    subtasks: lines(values.subtasks),
    blockedBy: values.dependency ? [values.dependency] : [],
    attachments: files.map((file) => ({ title: file.name, size: file.size })),
    parentId,
  }
}
export function createTaskComposer(ctx) {
  const drafts = new Map()
  const revision = signal(0)
  const key = () => (ctx.route() === 'subtask-new' ? `child:${ctx.record()}` : 'task')
  const draft = () => {
    const id = key()
    if (!drafts.has(id))
      drafts.set(id, {
        title: '',
        description: '',
        projectId: ctx.project(),
        assigneeIds: assignableUsers(ctx.data(), ctx.project()).some((u) => u.id === ctx.data().user.id)
          ? [ctx.data().user.id]
          : [],
        priority: 'normal',
        status: statusForKind(ctx.data(), ctx.project(), 'todo'),
        sprint: 'Backlog',
        type: 'task',
        points: '',
        tags: [],
        startDate: '',
        dueDate: '',
        checklist: '',
        subtasks: '',
        dependency: '',
      })
    return drafts.get(id)
  }
  return {
    view() {
      revision()
      const d = draft(),
        disabled = !ctx.canWrite()
      const propertyIcons = {
        projectId: 'folder',
        type: 'list',
        status: 'status',
        assignee: 'user',
        priority: 'flag',
        sprint: 'layers',
        startDate: 'calendar',
        dueDate: 'calendar',
        points: 'clock',
        tags: 'tag',
        dependency: 'link',
      }
      const input = (id, label, extra = {}) =>
        FlowInput({
          id,
          label,
          icon: propertyIcons[id],
          value: d[id],
          disabled,
          onInput: (e) => {
            d[id] = e.target.value
          },
          ...extra,
        })
      const area = (id, label, placeholder) =>
        FlowTextarea({
          id,
          label,
          value: d[id],
          placeholder,
          disabled,
          onInput: (e) => {
            d[id] = e.target.value
          },
        })
      const select = (name, label, options) =>
        FlowSelectField({
          name,
          label,
          icon: propertyIcons[name],
          value: d[name],
          options,
          disabled,
          onChange: (e) => {
            d[name] = e.target.value
            if (name === 'projectId') {
              d.status = statusForKind(ctx.data(), d.projectId, 'todo')
              d.tags = []
              d.assigneeIds = d.assigneeIds.filter((id) =>
                assignableUsers(ctx.data(), d.projectId).some((u) => u.id === id),
              )
              d.sprint = 'Backlog'
              revision.set(revision() + 1)
            }
          },
        })
      const options = (values) => values.map((value) => ({ value, label: value }))
      return html`<form
        id="flow-task-create"
        on:submit=${(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const id = key()
          const values = {
            ...Object.fromEntries(new FormData(form)),
            tags: d.tags,
            assigneeIds: d.assigneeIds,
          }
          const files = [...(form.elements.attachments?.files ?? [])]
          ctx.create(
            taskCreatePayload(values, {
              parentId: ctx.route() === 'subtask-new' ? ctx.record() : null,
              files,
            }),
            () => drafts.delete(id),
          )
        }}
      >
        ${FlowRecordLayout({
          main: FlowSection({
            children: FlowStack({
              children: html`${FlowInline({ children: html`${FlowTag({ label: ctx.route() === 'subtask-new' ? tr('flow.ui.subtask.of', [ctx.record()]) : tr('flow.ui.new.task') })}${FlowTag({ label: tr('flow.ui.draft.not.created') })}` })}${input('title', tr('flow.ui.title'), { required: true, placeholder: tr('flow.ui.what.needs.to.be.done'), error: ctx.errors().title })}${FlowLiveDoc(
                {
                  id: `task-draft-${key()}`,
                  label: tr('flow.ui.description'),
                  text: d.description,
                  snapshot: d.descriptionDoc,
                  readOnly: disabled,
                  onChange: (value) => {
                    d.description = FlowLiveDocText(value)
                    d.descriptionDoc = value.snapshot
                  },
                },
              )}${FlowDisclosure({ title: tr('flow.ui.checklist.subtasks.files'), children: html`${area('checklist', 'Checklist', tr('flow.ui.one.checklist.item.per.line'))}${area('subtasks', tr('flow.ui.subtasks'), tr('flow.ui.one.subtask.per.line.created.with.this.task'))}${FlowInput({ id: 'attachments', label: tr('flow.ui.attachments'), type: 'file', multiple: true, disabled })}${FlowNotice({ title: tr('flow.ui.files.in.this.prototype'), message: tr('flow.ui.stores.names.and.sizes.for.layout.preview.file.contents.are.not.uploaded') })}` })}`,
            }),
          }),
          aside: FlowPropertyFields({
            children: html`${select('projectId', tr('flow.ui.projects'), [
              { value: '', label: tr('flow.ui.select.project.8930e1') },
              ...ctx.data().projects.map((p) => ({ value: p.id, label: p.title })),
            ])}${select('type', tr('flow.ui.task.type'), [...ctx.data().types.map((t) => ({ value: t.id, label: t.title })), { value: 'milestone', label: tr('flow.ui.milestone') }])}${select(
              'status',
              tr('flow.ui.status'),
              taskColumns(ctx.data(), d.projectId).map((c) => ({ value: c.id, label: c.label })),
            )}${FlowUserPicker({
              id: 'create-assignees',
              label: tr('flow.ui.assignee.02be53'),
              size: 'md',
              value: d.assigneeIds,
              options: assignableUsers(ctx.data(), d.projectId),
              disabled: disabled || !d.projectId,
              placeholder: d.projectId
                ? tr('flow.ui.unassigned.1f3799')
                : tr('flow.ui.select.a.project.first'),
              onChange: (ids) => {
                d.assigneeIds = ids
                revision.set(revision() + 1)
              },
            })}${select('priority', tr('flow.ui.priority'), [
              { value: 'normal', label: tr('flow.ui.normal') },
              { value: 'high', label: tr('flow.ui.high') },
              { value: 'urgent', label: tr('flow.ui.urgent') },
            ])}${
              usesSprints(ctx.data().projects.find((p) => p.id === d.projectId))
                ? select(
                    'sprint',
                    'Sprint',
                    options([
                      'Backlog',
                      ...ctx
                        .data()
                        .sprints.filter((s) => s.projectId === d.projectId)
                        .map((s) => s.title),
                    ]),
                  )
                : null
            }${input('startDate', tr('flow.ui.start.date'), { type: 'date' })}${input('dueDate', tr('flow.ui.due.date'), { type: 'date' })}${ctx.data().quality ? html`<span data-flow="muted">${tr('flow.ui.ai.estimates.work.volume.from.deliverables.after.the.task.is.created')}</span>` : input('points', tr('flow.ui.estimate.points'), { type: 'number', min: '0' })}${FlowTagPicker(
              {
                id: 'create-tags',
                value: d.tags,
                options: taskTags(ctx.data(), d.projectId),
                disabled,
                onChange: (ids) => {
                  d.tags = ids
                  revision.set(revision() + 1)
                },
              },
            )}${select('dependency', tr('flow.ui.blocked.by.87822e'), [
              { value: '', label: tr('flow.ui.no.dependencies') },
              ...ctx
                .data()
                .tasks.filter((t) => !t.archived)
                .map((t) => ({ value: t.id, label: `${t.id} · ${t.title}` })),
            ])}`,
          }),
        })}
      </form>`
    },
  }
}
