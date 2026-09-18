import { defineIsland } from '@ketvietlab/ketjs-view'
import type { KetTableConfig } from '@ketvietlab/design-system'
import { createChartView, type ChartSpec } from '../../ui/client/chart-view.tsx'
import { createRelationSelectView, type RelationSelectConfig } from '../../ui/client/relation-select-view.tsx'
import { ketTable } from '../../ui/client/ket-table-view.tsx'

type ChartProps = { id: string; config: ChartSpec }
type RelationSelectProps = { id: string; config: RelationSelectConfig }
type KetTableProps = { id: string; config: KetTableConfig }

export const islands = {
  /**
   * One chart. Keyed by id because a screen draws several, and an unkeyed
   * island is a single global instance — three charts would have been three
   * hydrations of the last one.
   */
  'backend.chart': defineIsland<ChartProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/chart.mjs',
    export: 'chart',
    view: (props) => createChartView(props).view,
  }),
  'backend.relation-select': defineIsland<RelationSelectProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/relation-select.mjs',
    export: 'relationSelect',
    view: (props) => createRelationSelectView(props),
  }),
  'backend.ket-table': defineIsland<KetTableProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/ket-table.mjs',
    export: 'ketTable',
    view: (props) => ketTable(props),
  }),
}
