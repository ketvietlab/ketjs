// @ts-expect-error Browser import served by the KetJS runtime.
import { each, html, signal } from '/_ket/view/index.js'
import { createFlowBoardView } from './flow-board-view.mjs'

const runtime = { each, html, signal }
/** @param {Record<string, unknown>} props */
export const board = (props) => createFlowBoardView(runtime, props)
