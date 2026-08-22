import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'
import type { RelationOption } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]

/**
 * The CRM's relational fields, as pickers rather than bare selects.
 *
 * A select has to carry every row it might offer, so the case form used to ship
 * a thousand partners and every user in the tenant on each render, and offered
 * no way to find one by typing. Each picker below reads through a function that
 * takes the `search` and `limit` it sends on every keystroke; where creating the
 * missing record is part of the same job — a new contact, a new tag — it also
 * carries the save function, so the user never leaves the form they are filling.
 *
 * Fields over a small, fixed vocabulary — kind, priority, warehouse, activity
 * type, plan — stay native selects on purpose: a dialog to choose between four
 * values is worse than the four values.
 */

const empty = (options: RelationOption[]): RelationOption[] => [{ value: '', label: '—' }, ...options]

export const partnerControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; partners: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'partnerId',
    ariaLabel: _('crm_backend.field.partner'),
    value: options.value,
    required: options.required,
    options: empty(options.partners),
    labels: relationLabels(_, _('crm_backend.relation.partners')),
    manager: {
      listFunction: 'partner.listPartners',
      descriptionField: 'email',
      saveFunction: 'partner.savePartner',
      // A lead's contact is a person until someone says otherwise, and the
      // picker's editor only asks for what a salesperson has to hand.
      saveDefaults: { kind: 'person' },
      fields: [
        { name: 'name', label: _('crm_backend.field.partner'), required: true },
        { name: 'email', label: _('crm_backend.field.email'), type: 'email' },
        { name: 'phone', label: _('crm_backend.field.phone'), type: 'tel' },
      ],
    },
  })

export const assigneeControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; name?: string; value?: string | null; users: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name ?? 'assigneeUserId',
    ariaLabel: _('crm_backend.field.assignee'),
    value: options.value,
    required: options.required,
    options: empty(options.users),
    labels: relationLabels(_, _('crm_backend.relation.users')),
    manager: { listFunction: 'user.listUsers', descriptionField: 'login' },
  })

export const teamControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; teams: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'teamId',
    ariaLabel: _('crm_backend.field.team'),
    value: options.value,
    required: options.required,
    options: empty(options.teams),
    labels: relationLabels(_, _('crm_backend.relation.teams')),
    manager: { listFunction: 'crm.team.list', descriptionField: 'code' },
  })

export const stageControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: {
    id: string
    value?: string | null
    stages: RelationOption[]
    /** Restricts the list to the stages that accept this record kind. */
    kind?: string | null
    required?: boolean
  },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'stageId',
    ariaLabel: _('crm_backend.field.stage'),
    value: options.value,
    required: options.required,
    options: options.stages,
    labels: relationLabels(_, _('crm_backend.relation.stages')),
    manager: {
      listFunction: 'crm.stage.list',
      descriptionField: 'code',
      ...(options.kind ? { listInput: { kind: options.kind } } : {}),
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
    ariaLabel: _('crm_backend.field.tags'),
    multiple: true,
    values: options.values,
    options: options.tags,
    labels: relationLabels(_, _('crm_backend.relation.tags')),
    manager: {
      listFunction: 'crm.tag.list',
      saveFunction: 'crm.tag.save',
      removeFunction: 'crm.tag.archive',
      fields: [{ name: 'name', label: _('crm_backend.field.tags'), required: true }],
    },
  })

export const caseControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; name: string; kind?: string | null; excludeId?: string; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name,
    ariaLabel: _('crm_backend.merge.source'),
    required: options.required,
    // Deliberately empty: the merge source is found by typing, never by
    // scrolling a list of every case in the pipeline.
    options: [],
    labels: relationLabels(_, _('crm_backend.relation.cases')),
    manager: {
      listFunction: 'crm.case.options',
      listInput: {
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.excludeId ? { excludeId: options.excludeId } : {}),
      },
    },
  })

export const productControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; name?: string; products: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name ?? 'productId',
    ariaLabel: _('crm_backend.quotation.product'),
    required: options.required,
    options: empty(options.products),
    labels: relationLabels(_, _('crm_backend.relation.products')),
    manager: { listFunction: 'crm_sale.sale.listQuotableProducts', descriptionField: 'ref' },
  })
