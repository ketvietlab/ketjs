import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createSaleEditorStatusView } from './client/editor-view.mjs'

const runtime = { html, signal }

type SaleEditorProps = { identity: string; orderId: string; lang?: string }

export const islands = {
  'sale.editor': defineIsland<SaleEditorProps>()({
    props: { identity: 'text', orderId: 'id', lang: 'text?' },
    key: ['identity'],
    view: (props) => createSaleEditorStatusView(runtime, props),
  }),
}
