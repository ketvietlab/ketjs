import { html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createProductEditorView } from './client/editor-view.mjs'
import { createProductMediaUploadView } from './client/media-upload-view.mjs'

const runtime = { html, signal }

export const islands: Record<string, IslandDefinition> = {
  'product.editor': {
    props: { identity: 'text', templateId: 'id?', productId: 'id?', lang: 'text?' },
    key: ['identity'],
    client: 'product.mjs',
    export: 'editor',
    view: (props: IslandProps) => createProductEditorView(runtime, props),
  },
  'product.media-upload': {
    props: { identity: 'text', action: 'text', label: 'text' },
    key: ['identity'],
    client: 'product.mjs',
    export: 'mediaUpload',
    view: (props: IslandProps) => createProductMediaUploadView(runtime, props),
  },
}
