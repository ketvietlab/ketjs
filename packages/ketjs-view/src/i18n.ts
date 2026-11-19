/** A message is a string, or one string per plural category. */
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>>
export type Catalog = Record<string, Message>
export type Messages = Record<string, Catalog>

export type TranslateOptions = {
  /** Used when the requested locale has no entry. Omit to show the key for missing messages. */
  fallback?: string
  /** Called with every key that had to fall back — for finding gaps in production. */
  onMissing?: (key: string, locale: string) => void
}

/**
 * Conventionally bound to `_`, after gettext:
 *
 *     const _ = translator(messages, locale)
 *     _('backend.pages.title')
 *     _('shop.cart', { count: 5 })
 */
export type Translator = {
  (key: string, params?: Record<string, unknown>): string
  locale: string
  /** True when THIS locale has the key, rather than falling back for it. */
  has(key: string): boolean
  /**
   * True when the key produces a translation at all, from this locale or the
   * fallback. Use this to decide whether to translate; `has` answers a different
   * question and using it here means the pseudo-locale silently stops expanding,
   * which is the one thing it exists to do.
   */
  resolves(key: string): boolean
}

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * Pseudo-locale: every string comes back longer and bracketed. It exists so a
 * layout can be tested against text expansion before a real translation arrives —
 * Vietnamese is short and English is not, and a design tuned to the shorter one
 * breaks on the longer.
 */
export const PSEUDO_LOCALE = 'qps'
const pseudo = (s: string): string => `⟦${s.replace(/[aeiouAEIOU]/g, (c) => c + c.toLowerCase())}⟧`

const pluralRulesByLocale = new Map<string, Intl.PluralRules>()

const intlLocale = (locale: string): string => (locale === PSEUDO_LOCALE ? 'en' : locale)

const pluralRulesFor = (locale: string): Intl.PluralRules => {
  const key = intlLocale(locale)
  let rules = pluralRulesByLocale.get(key)
  if (!rules) {
    rules = new Intl.PluralRules(key)
    pluralRulesByLocale.set(key, rules)
  }
  return rules
}

export function translator(messages: Messages, locale: string, options: TranslateOptions = {}): Translator {
  const primary = messages[locale] ?? {}
  const secondary = options.fallback === undefined ? {} : (messages[options.fallback] ?? {})
  const plural = pluralRulesFor(locale)

  const resolve = (key: string): { message: Message | undefined; exact: boolean } => {
    if (key in primary) return { message: primary[key], exact: true }
    if (key in secondary) return { message: secondary[key], exact: false }
    return { message: undefined, exact: false }
  }

  const t = ((key: string, params: Record<string, unknown> = {}): string => {
    const { message, exact } = resolve(key)
    if (!exact) options.onMissing?.(key, locale)

    let text: string
    if (message === undefined)
      text = key // visible, not blank
    else if (typeof message === 'string') text = message
    else {
      const count = Number(params.count ?? 0)
      text = message[plural.select(count)] ?? message.other ?? key
    }

    text = text.replace(PLACEHOLDER, (_, name: string) => String(params[name] ?? `{${name}}`))
    return locale === PSEUDO_LOCALE ? pseudo(text) : text
  }) as Translator

  t.locale = locale
  t.has = (key: string) => key in primary
  t.resolves = (key: string) => key in primary || key in secondary
  return t
}

/** Which keys each locale is missing, measured against the union of all of them. */
export function missingMessages(catalogs: Messages, locales?: readonly string[]): Record<string, string[]> {
  const wanted = locales ?? Object.keys(catalogs)
  const every = new Set<string>()
  for (const c of Object.values(catalogs)) for (const k of Object.keys(c)) every.add(k)

  const out: Record<string, string[]> = {}
  for (const locale of wanted) {
    const have = catalogs[locale] ?? {}
    const gaps = [...every].filter((k) => !(k in have)).sort()
    if (gaps.length) out[locale] = gaps
  }
  return out
}

export function formatMissing(missing: Record<string, string[]>): string {
  const entries = Object.entries(missing)
  if (!entries.length) return 'every locale has every key'
  return entries
    .map(([locale, keys]) => `${locale}: ${keys.length} missing\n${keys.map((k) => `  ${k}`).join('\n')}`)
    .join('\n')
}
