import { each, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from './design/client/relation-select-view.mjs'
import { createTableSelectionView } from './design/client/table-selection-view.mjs'

const runtime = { each, html, signal }

export const islands: Record<string, IslandDefinition> = {
  'backend.table-selection': {
    props: {},
    client: 'client/table-selection.mjs',
    export: 'tableSelection',
    view: () => createTableSelectionView(runtime),
  },
  'backend.relation-select': {
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/relation-select.mjs',
    export: 'relationSelect',
    view: (props: IslandProps) => createRelationSelectView(runtime, props),
  },
}
