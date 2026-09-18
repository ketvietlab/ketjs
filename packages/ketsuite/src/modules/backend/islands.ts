import { defineIsland } from '@ketvietlab/ketjs-view'
import {
  createLightboxView,
  createRelationSelectView,
  type KetTableConfig,
  type LightboxConfig,
  type RelationSelectConfig,
  type SearchFilterConfig,
} from '@ketvietlab/design-system'
import { createChartView, type ChartSpec } from '../../ui/client/chart-view.tsx'
import { ketTable } from '../../ui/client/ket-table-view.tsx'
import { searchFilter } from '../../ui/client/search-filter-view.tsx'

type ChartProps = { id: string; config: ChartSpec }
type RelationSelectProps = { id: string; config: RelationSelectConfig }
type KetTableProps = { id: string; config: KetTableConfig }
type SearchFilterProps = { id: string; config: SearchFilterConfig }
type LightboxProps = { id: string; config: LightboxConfig }

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
  /** The design-system image viewer: a thumbnail that opens zoom, pan and pinch over a set of images. */
  'backend.lightbox': defineIsland<LightboxProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/lightbox.mjs',
    export: 'lightbox',
    view: (props) => createLightboxView(props),
  }),
  'backend.ket-table': defineIsland<KetTableProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/ket-table.mjs',
    export: 'ketTable',
    view: (props) => ketTable(props),
  }),
  'backend.search-filter': defineIsland<SearchFilterProps>()({
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/search-filter.mjs',
    export: 'searchFilter',
    view: (props) => searchFilter(props),
  }),
}
