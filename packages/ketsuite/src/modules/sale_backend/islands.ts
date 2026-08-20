import { html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createSaleEditorView } from './client/editor-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'sale.editor': {
    props: { identity: 'text', orderId: 'id', lang: 'text?' },
    key: ['identity'],
    client: 'sale.mjs',
    export: 'editor',
    view: (props: IslandProps) => createSaleEditorView(runtime, props),
  },
}
