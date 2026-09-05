import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createChartView, type ChartSpec } from '../../ui/client/chart-view.tsx'
import { createRelationSelectView, type RelationSelectConfig } from '../../ui/client/relation-select-view.tsx'
import { createTableSelectionView } from '../../ui/client/table-selection-view.tsx'

export const islands: Record<string, IslandDefinition> = {
  /**
   * One chart. Keyed by id because a screen draws several, and an unkeyed
   * island is a single global instance — three charts would have been three
   * hydrations of the last one.
   */
  'backend.chart': {
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/chart.mjs',
    export: 'chart',
    view: (props: IslandProps) =>
      createChartView(props as IslandProps & { id: string; config: ChartSpec }).view,
  },
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
