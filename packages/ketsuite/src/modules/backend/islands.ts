import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createRelationSelectView, type RelationSelectConfig } from '../../ui/client/relation-select-view.tsx'
import { createTableSelectionView } from '../../ui/client/table-selection-view.tsx'

export const islands: Record<string, IslandDefinition> = {
  'backend.table-selection': {
    props: {},
    client: 'client/table-selection.mjs',
    export: 'tableSelection',
    view: () => createTableSelectionView(),
  },
  'backend.relation-select': {
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/relation-select.mjs',
    export: 'relationSelect',
    view: (props: IslandProps) =>
      createRelationSelectView(props as IslandProps & { id: string; config: RelationSelectConfig }),
  },
}
