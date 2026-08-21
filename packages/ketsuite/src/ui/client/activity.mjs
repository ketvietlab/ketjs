// @ts-expect-error Browser import served by the KetJS runtime.
import { each, html, signal } from '/_ket/view/index.js'
import { createActivityIndicatorView, createRecordActivityView } from './activity-view.mjs'

const runtime = { each, html, signal }

/** @param {Record<string, unknown>} props */
export const record = (props) => createRecordActivityView(runtime, props)
/** @param {Record<string, unknown>} props */
export const indicator = (props) => createActivityIndicatorView(runtime, props)
