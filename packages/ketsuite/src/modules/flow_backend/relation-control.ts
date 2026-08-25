import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'
import type { RelationOption } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]

/**
 * Flow's relational fields, as pickers rather than bare selects — direct copy
 * of crm_backend/relation-control.ts's shape against Flow's own functions.
 *
 * Epic and Sprint deliberately carry no `saveFunction`: the relation-select
 * client posts a picker's inline-create as flat fields straight to that
 * function (confirmed in relation-select-view.mjs's `save()` — `{...saveDefaults,
 * id, ...formFields}`, no wrapper), which matches `flow.tag.save`'s own flat
 * shape but not `flow.epic.save`'s (built on the generic `saveEntity` helper,
 * which expects `{values, idempotencyKey}`). An epic is also a planning
 * artifact created on its own panel, not a throwaway found-by-typing record
 * like a tag or a contact — so these two stay picker-only rather than growing
 * a second, flat-shaped save function just to fit the inline-create wire format.
 */

const empty = (options: RelationOption[]): RelationOption[] => [{ value: '', label: '—' }, ...options]

export const assigneeControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; users: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'assigneeUserId',
    ariaLabel: _('flow_backend.field.assignee'),
    value: options.value,
    required: options.required,
    options: empty(options.users),
    labels: relationLabels(_, _('flow_backend.relation.users')),
    manager: { listFunction: 'user.listUsers', descriptionField: 'login' },
  })

export const epicControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; projectId: string; epics: RelationOption[] },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'epicId',
    ariaLabel: _('flow_backend.field.epic'),
    value: options.value,
    options: empty(options.epics),
    labels: relationLabels(_, _('flow_backend.relation.epics')),
    manager: {
      listFunction: 'flow.epic.list',
      listInput: { projectId: options.projectId },
      labelField: 'title',
    },
  })

export const sprintControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; projectId: string; sprints: RelationOption[] },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'sprintId',
    ariaLabel: _('flow_backend.field.sprint'),
    value: options.value,
    options: empty(options.sprints),
    labels: relationLabels(_, _('flow_backend.relation.sprints')),
    manager: { listFunction: 'flow.sprint.list', listInput: { projectId: options.projectId } },
  })

export const tagsControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; values?: string[]; tags: RelationOption[] },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'tagIds',
    ariaLabel: _('flow_backend.field.tags'),
    multiple: true,
    values: options.values,
    options: options.tags,
    labels: relationLabels(_, _('flow_backend.relation.tags')),
    manager: {
      listFunction: 'flow.tag.list',
      saveFunction: 'flow.tag.save',
      removeFunction: 'flow.tag.archive',
      fields: [{ name: 'name', label: _('flow_backend.field.tags'), required: true }],
    },
  })

/** The dependency-add picker — found by typing, never by scrolling every issue in the project. */
export const issueControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; name: string; projectId?: string; excludeId?: string; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name,
    ariaLabel: _('flow_backend.dependencies.target'),
    required: options.required,
    options: [],
    labels: relationLabels(_, _('flow_backend.relation.issues')),
    manager: {
      listFunction: 'flow.issue.options',
      listInput: {
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.excludeId ? { excludeId: options.excludeId } : {}),
      },
      labelField: 'title',
      descriptionField: 'columnName',
    },
  })
