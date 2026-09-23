// @ts-expect-error Browser import served by the KetJS runtime.
import { html, signal } from '/_ket/view/index.js'
import { productEditorBehavior } from './editor-view.mjs'
import { createProductMediaUploadView } from './media-upload-view.mjs'

const runtime = { html, signal }

export const editorBehavior = productEditorBehavior
/** @param {Record<string, unknown>} props */
export const mediaUpload = (props) => createProductMediaUploadView(runtime, props)
