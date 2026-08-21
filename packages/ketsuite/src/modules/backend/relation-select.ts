import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'

export type RelationOption = { value: string; label: string; description?: string | null }

export type RelationEditorField = {
  name: string
  label: string
  type?: 'text' | 'email' | 'tel' | 'select'
  required?: boolean
  options?: RelationOption[]
}

export type RelationManager = {
  listFunction: string
  listInput?: Record<string, unknown>
  searchParam?: string
  limitParam?: string
  limit?: number
  idField?: string
  labelField?: string
  descriptionField?: string
  saveFunction?: string
  saveDefaults?: Record<string, unknown>
  removeFunction?: string
  removeDefaults?: Record<string, unknown>
  fields?: RelationEditorField[]
  excludeIds?: string[]
}

export type RelationSelectLabels = {
  choose: string
  search: string
  more: string
  noRecords: string
  loading: string
  loadError: string
  dialogTitle: string
  close: string
  select: string
  create: string
  edit: string
  save: string
  cancel: string
  remove: string
  confirmRemove: string
  retry: string
}

export type RelationSelectConfig = {
  name: string
  ariaLabel: string
  value?: string | null
  options: RelationOption[]
  required?: boolean
  disabled?: boolean
  labels: RelationSelectLabels
  manager?: RelationManager
}

type Req = Parameters<Route>[1]

export const relationControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: RelationSelectConfig,
): Promise<JSXChild> => ctx.joint(url, req, 'backend:relation.select', { id, config })

export const relationLabels = (_: Translator, dialogTitle: string): RelationSelectLabels => ({
  choose: _('backend.relation.choose'),
  search: _('backend.relation.search'),
  more: _('backend.relation.more'),
  noRecords: _('backend.relation.noRecords'),
  loading: _('backend.relation.loading'),
  loadError: _('backend.relation.loadError'),
  dialogTitle,
  close: _('backend.relation.close'),
  select: _('backend.relation.select'),
  create: _('backend.relation.create'),
  edit: _('backend.relation.edit'),
  save: _('backend.relation.save'),
  cancel: _('backend.relation.cancel'),
  remove: _('backend.relation.remove'),
  confirmRemove: _('backend.relation.confirmRemove'),
  retry: _('backend.relation.retry'),
})
