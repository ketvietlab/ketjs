// @ts-nocheck Address form island bootstrap.
// @ts-expect-error Browser import served by the KetJS runtime.
import { each, html, signal } from '/_ket/view/index.js'
import { createAddressFormView } from './address-view.mjs'

const runtime = { each, html, signal }
export const form = (props) => createAddressFormView(runtime, props)
