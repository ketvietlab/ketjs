import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createStockEditorStatusView } from './client/editor-view.mjs'

const runtime = { html, signal }

type StockEditorProps = { identity: string; pickingId?: string; lotId?: string; lang?: string }

export const islands = {
  'stock.editor': defineIsland<StockEditorProps>()({
    props: { identity: 'text', pickingId: 'id?', lotId: 'id?', lang: 'text?' },
    key: ['identity'],
    view: (props) => createStockEditorStatusView(runtime, props),
  }),
}
