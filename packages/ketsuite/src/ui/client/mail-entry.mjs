import { each, html, signal } from '@ketvietlab/ketjs-view'
import { createChatterView, createInboxIndicatorView } from './mail-view.mjs'

const runtime = { each, html, signal }

/** @param {Record<string, unknown>} props */
export const chatter = (props) => createChatterView(runtime, props)
/** @param {Record<string, unknown>} props */
export const inboxIndicator = (props) => createInboxIndicatorView(runtime, props)
