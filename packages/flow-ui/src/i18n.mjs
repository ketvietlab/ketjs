import { signal, html, each } from '@ketvietlab/ketjs-view'
import { translator, dateTimeFormatter } from '@ketvietlab/ketjs'
import { flowMessages } from './messages.mjs'
export { flowMessages } from './messages.mjs'

// Equivalent to KetJS composition for the standalone Flow island. The real app
// can register flowMessages on its flow module and inject its composed translator.
/** @typedef {Record<string, Record<string, string>>} FlowCatalog Locale → key (without the `flow.` prefix) → text. */
const prefixed = (/** @type {FlowCatalog} */ catalog) =>
  Object.fromEntries(
    Object.entries(catalog).map(([lang, entries]) => [
      lang,
      Object.fromEntries(Object.entries(entries).map(([key, value]) => ['flow.' + key, value])),
    ]),
  )
/** @type {{messages: FlowCatalog}} */
const manifest = { messages: prefixed(flowMessages) }
/** Kit messages plus every registered extension catalog. */
export const flowMessageManifest = /** @type {import('@ketvietlab/ketjs').Manifest} */ (
  /** @type {unknown} */ (manifest)
)
const translators = new Map()
const rebuild = () => {
  for (const code of FLOW_LOCALE_CODES())
    translators.set(code, translator(flowMessageManifest, code, { fallback: 'en' }))
}
rebuild()
/** Adds a product or extension catalog to the shared translator. Keys must not collide with registered ones.
 * @param {FlowCatalog} catalog */
export function registerFlowMessages(catalog) {
  const next = prefixed(catalog)
  for (const [lang, entries] of Object.entries(next))
    for (const key of Object.keys(entries))
      if (key in (manifest.messages[lang] ?? {}))
        throw new Error(`Flow message ${key} is already registered for ${lang}`)
  for (const [lang, entries] of Object.entries(next)) Object.assign((manifest.messages[lang] ??= {}), entries)
  rebuild()
}
function FLOW_LOCALE_CODES() {
  return ['en', 'ja', 'vi']
}

/** @typedef {'en'|'ja'|'vi'} FlowLocale */
export const FLOW_LANGUAGES = Object.freeze([
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'vi', label: 'Tiếng Việt' },
])
/** @param {unknown} value @returns {FlowLocale} */
export const normalizeFlowLocale = (value) => (value === 'ja' || value === 'vi' ? value : 'en')
const locale = signal(/** @type {FlowLocale} */ ('en'))
export const flowLocale = () => locale()
/** A browser preference; no API data, names or field values are rewritten. @param {unknown} value */
export const setFlowLocale = (value) => locale.set(normalizeFlowLocale(value))
export const flowLocaleTag = () => ({ en: 'en-US', ja: 'ja-JP', vi: 'vi-VN' })[locale()]
/** Thin reactive binding to KetJS. Placeholder substitution and fallback belong to KetJS.
 * @param {string} key @param {readonly unknown[]} [values] @returns {string} */
export function tr(key, values = []) {
  return (translators.get(locale()) ?? translator(flowMessageManifest, 'en'))(
    key,
    Object.fromEntries(values.map((value, index) => [String(index), value])),
  )
}
/** @param {Intl.DateTimeFormatOptions} options */
export const flowDateFormatter = (options) => dateTimeFormatter(flowLocaleTag(), options)
/** For translated text interleaved with icons or other renderable slots. */
export function trRich(/** @type {string} */ source, /** @type {unknown[]} */ values) {
  const markers = values.map((_, i) => `\uE000${i}\uE001`)
  const parts = tr(source, markers)
    .split(/(\uE000\d+\uE001)/g)
    .map((part) => (/^\uE000/.test(part) ? values[Number(part.slice(1, -1))] : part))
  return html`${each(
    parts,
    (_, i) => i,
    (part) => html`${part}`,
  )}`
}
