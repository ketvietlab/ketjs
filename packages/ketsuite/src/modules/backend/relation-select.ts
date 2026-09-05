import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { RelationSelectConfig, RelationSelectLabels } from '../../ui/client/relation-select-view.tsx'

export type {
  RelationEditorField,
  RelationManager,
  RelationOption,
  RelationSelectConfig,
  RelationSelectLabels,
} from '../../ui/client/relation-select-view.tsx'

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
  clear: _('backend.relation.clear'),
  chosen: _('backend.relation.chosen'),
})
