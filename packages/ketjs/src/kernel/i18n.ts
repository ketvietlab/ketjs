import {
  missingMessages as missingCatalogMessages,
  PSEUDO_LOCALE,
  translator as catalogTranslator,
} from '@ketvietlab/ketjs-view/i18n'
import type { TranslateOptions, Translator } from '@ketvietlab/ketjs-view/i18n'
import type { Manifest } from '../types.ts'

export { formatMissing, PSEUDO_LOCALE } from '@ketvietlab/ketjs-view/i18n'
export type { Catalog, Message, Messages, TranslateOptions, Translator } from '@ketvietlab/ketjs-view/i18n'

export function translator(manifest: Manifest, locale: string, options: TranslateOptions = {}): Translator {
  return catalogTranslator(manifest.messages ?? {}, locale, {
    ...options,
    fallback: options.fallback ?? 'vi',
  })
}

export function missingMessages(manifest: Manifest, locales?: string[]): Record<string, string[]> {
  return missingCatalogMessages(manifest.messages ?? {}, locales)
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

const dateTimeOptionsKey = (options: Intl.DateTimeFormatOptions): string =>
  JSON.stringify(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en')),
  )

/**
 * A shared date/time formatter for server rendering and timezone calculations.
 *
 * ECMA-402 formatters are immutable after construction, expensive to create and
 * cheap to reuse. Canonicalizing the option entries means callers get the same
 * formatter even when equivalent object literals list their properties in a
 * different order.
 */
export function dateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  const resolvedLocale = locale === PSEUDO_LOCALE ? 'en' : locale
  const key = `${resolvedLocale}\0${dateTimeOptionsKey(options)}`
  let formatter = dateTimeFormats.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(resolvedLocale, options)
    dateTimeFormats.set(key, formatter)
  }
  return formatter
}
