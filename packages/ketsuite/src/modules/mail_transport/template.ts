import { KetError } from '@ketvietlab/ketjs'

const placeholder = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g

const fail = (message: string): never => {
  throw new KetError({ code: 'E_MAIL_TEMPLATE', module: 'mail_transport', message })
}

export const jsonValue = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fail('stored JSON is invalid')
  }
}

const scalarAt = (context: Record<string, unknown>, key: string): string => {
  let value: unknown = context
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !(segment in value))
      return fail(`template value "${key}" is missing`)
    value = (value as Record<string, unknown>)[segment]
  }
  if (value == null) return ''
  if (!['string', 'number', 'boolean'].includes(typeof value))
    return fail(`template value "${key}" must be a string, number or boolean`)
  return String(value)
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const renderTemplate = (
  source: string,
  context: Record<string, unknown>,
  allowedKeys: readonly string[],
  mode: 'text' | 'html' = 'text',
): string => {
  const allowed = new Set(allowedKeys)
  return source.replace(placeholder, (_match, key: string) => {
    if (!allowed.has(key)) return fail(`template key "${key}" is not allowlisted`)
    const rendered = scalarAt(context, key)
    return mode === 'html' ? escapeHtml(rendered) : rendered
  })
}

export const templateKeys = (source: string): string[] => {
  const keys = new Set<string>()
  for (const match of source.matchAll(placeholder)) keys.add(match[1]!)
  return [...keys]
}
