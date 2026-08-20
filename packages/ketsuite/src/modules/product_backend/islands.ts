import { html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createProductEditorView } from './client/editor-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'product.editor': {
    props: { templateId: 'id', lang: 'text?' },
    client: 'product.mjs',
    export: 'editor',
    view: (props: IslandProps) => createProductEditorView(runtime, props),
  },
}
