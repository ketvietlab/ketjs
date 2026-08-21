import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createProductEditorView } from './client/editor-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'product.editor': {
    props: { identity: 'text', templateId: 'id?', productId: 'id?', lang: 'text?' },
    key: ['identity'],
    client: 'product.mjs',
    export: 'editor',
    view: (props: IslandProps) => createProductEditorView(runtime, props),
  },
}
