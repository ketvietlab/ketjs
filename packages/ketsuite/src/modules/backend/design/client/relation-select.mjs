// @ts-nocheck Generic function-backed relational selector bootstrap.
// @ts-expect-error Browser import served by the KetJS runtime.
import { each, html, signal } from '/_ket/view/index.js'
import { createRelationSelectView } from './relation-select-view.mjs'

const runtime = { each, html, signal }
export const relationSelect = (props) => createRelationSelectView(runtime, props)
