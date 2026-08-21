import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createStockEditorView } from './client/editor-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'stock.editor': {
    props: { identity: 'text', pickingId: 'id?', lotId: 'id?', lang: 'text?' },
    key: ['identity'],
    client: 'stock.mjs',
    export: 'editor',
    view: (props: IslandProps) => createStockEditorView(runtime, props),
  },
}
