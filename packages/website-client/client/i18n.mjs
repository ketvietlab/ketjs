// Message lookup for the Studio. Core owns `website.*`; every extension registers its own
// catalog under its own prefix. A key has one owner, so a pro catalog can never rewrite core text.
import { coreMessages } from './messages.mjs'

const catalogs = new Map([['core', coreMessages]])
/** @type {Record<string, string>} */
const merged = { ...coreMessages.vi }

/**
 * @param {string} owner
 * @param {{ vi: Record<string, string> }} catalog
 */
export function registerMessages(owner, catalog) {
  if (catalogs.has(owner)) throw new Error(`Website messages for ${owner} are already registered`)
  const keys = Object.keys(catalog?.vi ?? {})
  const taken = keys.find((key) => Object.hasOwn(merged, key))
  if (taken) throw new Error(`Website message ${taken} is already defined`)
  catalogs.set(owner, catalog)
  Object.assign(merged, catalog.vi)
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function tr(key, params) {
  const text = merged[key]
  if (text === undefined) return key
  return params ? text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)) : text
}

export const hasMessage = (key) => Object.hasOwn(merged, key)
export const messageOwners = () => [...catalogs.keys()]
