import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createProductEditorStatusView } from './client/editor-view.mjs'
import { createProductMediaUploadView } from './client/media-upload-view.mjs'
import { defineRecordModalIsland } from '../../ui/record-modal.tsx'

const runtime = { html, signal }

type ProductEditorProps = { identity: string; templateId?: string; productId?: string; lang?: string }
type MediaUploadProps = { identity: string; action: string; label: string }

export const islands = {
  'product.editor': defineIsland<ProductEditorProps>()({
    props: { identity: 'text', templateId: 'id?', productId: 'id?', lang: 'text?' },
    key: ['identity'],
    view: (props) => createProductEditorStatusView(runtime, props),
  }),
  'product.media-upload': defineIsland<MediaUploadProps>()({
    props: { identity: 'text', action: 'text', label: 'text' },
    key: ['identity'],
    client: 'product.mjs',
    export: 'mediaUpload',
    view: (props) => createProductMediaUploadView(runtime, props),
  }),
  // The catalogue's rows and its create action open a template here (KetSuite
  // record-modal contract) — General and Variants tabs only; Media stays on the
  // server-rendered detail page for now (see modal/product-modal-view.tsx).
  'product.template-modal': defineRecordModalIsland({
    kind: 'product.template',
    client: 'product-modal.mjs',
    export: 'templateModal',
  }),
}
