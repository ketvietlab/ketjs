import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'
import type { RelationOption } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]

/**
 * Flow's relational fields, as pickers rather than bare selects — direct copy
 * of crm_backend/relation-control.ts's shape against Flow's own functions.
 *
 * There is deliberately no sprint picker: a project holds a handful of
 * sprints, and the rule this module inherits from crm_backend is that a field
 * over a small vocabulary stays a native select — "a dialog to choose between
 * four values is worse than the four values". The issue screen uses one.
 *
 * Epic deliberately carries no `saveFunction`: the relation-select
 * client posts a picker's inline-create as flat fields straight to that
 * function (confirmed in relation-select-view.tsx's `save()` — `{...saveDefaults,
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

/**
 * Who a comment is addressed to.
 *
 * The same list the assignee picker uses, taking several at once. A mention is
 * a deliberate act of naming somebody — the picker is the whole gesture, and it
 * is why the notification can be attributed correctly and fired exactly once.
 */
export const mentionControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'mentionUserIds',
    ariaLabel: _('flow_backend.field.mentions'),
    multiple: true,
    values: [],
    options: [],
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
