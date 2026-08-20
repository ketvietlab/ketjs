import { html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createStockEditorView } from './client/editor-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'stock.editor': {
    props: { pickingId: 'id?', lotId: 'id?', lang: 'text?' },
    client: 'stock.mjs',
    export: 'editor',
    view: (props: IslandProps) => createStockEditorView(runtime, props),
  },
}
