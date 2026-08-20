// @ts-expect-error Browser import served by the KetJS runtime.
import { html, signal } from '/_ket/view/index.js'
import { createProductEditorView } from './editor-view.mjs'

const runtime = { html, signal }

/** @param {Record<string, unknown>} props */
export const editor = (props) => createProductEditorView(runtime, props)
