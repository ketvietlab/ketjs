import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createProductEditorStatusView } from './client/editor-view.mjs'
import { createProductMediaUploadView } from './client/media-upload-view.mjs'
import { defineRecordModalIsland, defineRecordPageIsland } from '../../ui/record-modal.tsx'
import { createVariantEditorView, type VariantEditorProps } from '../../ui/client/variant-editor-view.tsx'

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
  // A template's own page (`/admin/product/templates/{id}`, `new` to create):
  // the server renders the RecordPage in its loading state and the client
  // renders the record — General and Variants tabs only; Media stays on the
  // server-rendered `?tab=media` page for now (see modal/product-modal-view.tsx).
  'product.template-page': defineRecordPageIsland({
    kind: 'product.template',
    client: 'product-modal.mjs',
    export: 'templatePage',
  }),
  'product.attribute-modal': defineRecordModalIsland({
    kind: 'product.attribute',
    client: 'attribute-modal.mjs',
    export: 'attributeModal',
  }),
  // The template modal's "Attributes & variants" tab — see ui/client/variant-editor-view.tsx.
  'product.variant-editor': defineIsland<VariantEditorProps>()({
    props: {
      id: 'id',
      kind: 'text',
      setup: 'json',
      editable: 'bool',
      createAttribute: 'bool?',
      saveFunction: 'text',
      labels: 'json',
      relationLabels: 'json',
      lightboxLabels: 'json',
      media: 'json',
    },
    key: ['id'],
    client: 'variant-editor.mjs',
    export: 'variantEditor',
    view: (props) => createVariantEditorView(props),
  }),
}
