import { defineRecordModalIsland } from '../../ui/record-modal.tsx'
import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createStockEditorStatusView } from './client/editor-view.mjs'

const runtime = { html, signal }

type StockEditorProps = { identity: string; pickingId?: string; lotId?: string; lang?: string }

export const islands = {
  'stock.transfer-modal': defineRecordModalIsland({
    kind: 'stock.transfer',
    client: 'stock-transfer-modal.mjs',
    export: 'transferModal',
  }),
  'stock.lot-modal': defineRecordModalIsland({
    kind: 'stock.lot',
    client: 'stock-configuration-modal.mjs',
    export: 'lotModal',
  }),
  'stock.route-modal': defineRecordModalIsland({
    kind: 'stock.route',
    client: 'stock-configuration-modal.mjs',
    export: 'stockRouteModal',
  }),
  'stock.replenishment-modal': defineRecordModalIsland({
    kind: 'stock.replenishment',
    client: 'stock-configuration-modal.mjs',
    export: 'replenishmentModal',
  }),
  'stock.count-modal': defineRecordModalIsland({
    kind: 'stock.count',
    client: 'inventory-count-modal.mjs',
    export: 'inventoryCountModal',
  }),
  'stock.warehouse-modal': defineRecordModalIsland({
    kind: 'stock.warehouse',
    client: 'stock-configuration-modal.mjs',
    export: 'warehouseModal',
  }),
  'stock.location-modal': defineRecordModalIsland({
    kind: 'stock.location',
    client: 'stock-configuration-modal.mjs',
    export: 'locationModal',
  }),
  'stock.picking-type-modal': defineRecordModalIsland({
    kind: 'stock.pickingType',
    client: 'stock-configuration-modal.mjs',
    export: 'pickingTypeModal',
  }),
  'stock.editor': defineIsland<StockEditorProps>()({
    props: { identity: 'text', pickingId: 'id?', lotId: 'id?', lang: 'text?' },
    key: ['identity'],
    view: (props) => createStockEditorStatusView(runtime, props),
  }),
}
