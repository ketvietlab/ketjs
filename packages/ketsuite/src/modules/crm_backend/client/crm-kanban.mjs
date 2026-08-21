// @ts-expect-error Browser import served by the KetJS runtime.
import { each, html, signal } from '/_ket/view/index.js'
import { createCrmKanbanView } from './crm-kanban-view.mjs'

const runtime = { each, html, signal }
/** @param {Record<string, unknown>} props */
export const pipeline = (props) => createCrmKanbanView(runtime, props)
