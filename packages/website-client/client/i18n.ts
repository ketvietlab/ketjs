// Message lookup for the Studio. Core owns `website.*`; every extension registers its own
// catalog under its own prefix. A key has one owner, so a pro catalog can never rewrite core text.
import { coreMessages } from './messages.ts'

export type MessageCatalog = { vi: Record<string, string> }

const catalogs = new Map<string, MessageCatalog>([['core', coreMessages]])
const merged: Record<string, string> = { ...coreMessages.vi }

export function registerMessages(owner: string, catalog: MessageCatalog) {
  if (catalogs.has(owner)) throw new Error(`Website messages for ${owner} are already registered`)
  const keys = Object.keys(catalog?.vi ?? {})
  const taken = keys.find((key) => Object.hasOwn(merged, key))
  if (taken) throw new Error(`Website message ${taken} is already defined`)
  catalogs.set(owner, catalog)
  Object.assign(merged, catalog.vi)
}

export function tr(key: string, params?: Record<string, string | number>): string {
  const text = merged[key]
  if (text === undefined) return key
  return params ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : text
}

export const hasMessage = (key: string) => Object.hasOwn(merged, key)
export const messageOwners = () => [...catalogs.keys()]
