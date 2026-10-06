import { compileKtl } from '@ketvietlab/ketjs'
import { THEME_FRAME_FILES, THEME_LIMITS } from './types.ts'
import type { SelectedTheme, ThemeFrameSlot, ThemeFrameTemplates } from './types.ts'

const tags = new Set(
  'div span header footer nav section aside a strong em b i small h1 h2 h3 h4 h5 h6 ul ol li img br hr button details summary p'.split(
    ' ',
  ),
)
const voids = new Set(['img', 'br', 'hr'])
const attributes = new Set(
  'class id title role href src alt width height type tabindex hidden open disabled data-customer-account'.split(
    ' ',
  ),
)
const booleans = new Set(['hidden', 'open', 'disabled', 'data-customer-account'])
const inline = new Set('span a strong em b i small img br'.split(' '))

/** Only a small, inert HTML fragment may occupy a frame slot. Never repair malformed markup. */
function checkMarkup(source: string, balanced: boolean): void {
  if (source.length > 256 * 1024) throw new Error('frame output exceeds 256 KiB')
  const stack: string[] = []
  const tokens = /<\/?[a-z][a-z0-9]*(?:\s+[a-z][a-z0-9-]*(?:\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))?)*\s*\/?>/g
  let end = 0
  for (const match of source.matchAll(tokens)) {
    if (source.slice(end, match.index).includes('<')) throw new Error('invalid frame markup')
    end = match.index + match[0].length
    const token = match[0]
    const name = /^<\/?([a-z0-9]+)/.exec(token)![1]!
    if (!tags.has(name)) throw new Error(`frame element ${name} is not allowed`)
    if (token.startsWith('</')) {
      if (token !== `</${name}>` || voids.has(name)) throw new Error('invalid closing element')
      if (balanced && stack.pop() !== name) throw new Error('unbalanced frame markup')
      continue
    }
    if (balanced) {
      if ((name === 'a' || name === 'button' || /^h[1-6]$/.test(name)) && stack.includes(name))
        throw new Error('implicitly closed frame element')
      if (stack.includes('p') && !inline.has(name)) throw new Error('block inside paragraph')
      if (!voids.has(name)) {
        if (token.endsWith('/>')) throw new Error('only void elements may self-close')
        stack.push(name)
      }
    }
    const seen = new Set<string>()
    const attrs = token.slice(name.length + 1, token.endsWith('/>') ? -2 : -1)
    for (const attr of attrs.matchAll(/([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const key = attr[1]!
      const value = attr[2] ?? attr[3]
      if (
        seen.has(key) ||
        (!attributes.has(key) && !/^aria-[a-z-]+$/.test(key) && !/^data-theme-[a-z-]+$/.test(key))
      )
        throw new Error(`frame attribute ${key} is not allowed`)
      seen.add(key)
      if (value === undefined && !booleans.has(key)) throw new Error('frame attributes require quoted values')
      if (key === 'id' && !value?.startsWith('theme-')) throw new Error('frame ids must start with theme-')
      if ((key === 'href' || key === 'src') && value !== undefined) {
        // Resolve the entities HTML would resolve before deciding whether a URL is inert.
        const url = value.replace(
          /&(?:#(x[0-9a-f]+|[0-9]+)|([a-z]+));/gi,
          (_all, number: string | undefined, word: string | undefined) => {
            if (number) {
              const code = number[0]?.toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number)
              return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\u0000'
            }
            return (
              ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[word!] ??
              '\u0000'
            )
          },
        )
        if (
          [...url].some((ch) => ch.charCodeAt(0) <= 32) ||
          /[\\<>]/.test(url) ||
          /&(?:#|[a-z]+;)/i.test(url) ||
          url.startsWith('//') ||
          !(/^(?:\/(?!\/)|#|https:\/\/)/.test(url) || (key === 'href' && /^(?:mailto:|tel:)/.test(url)))
        )
          throw new Error('unsafe frame URL')
      }
    }
  }
  if (source.slice(end).includes('<') || (balanced && stack.length))
    throw new Error('unbalanced frame markup')
}

/** Install and cold render use exactly the same compiler and inert-markup gate. */
export function compileThemeFrame(source: string, slot: ThemeFrameSlot) {
  if (new TextEncoder().encode(source).byteLength > THEME_LIMITS.frameBytes)
    throw new Error('frame source exceeds 64 KiB')
  const compiled = compileKtl(source, {
    mode: 'frame',
    name: THEME_FRAME_FILES[slot],
    maxIterations: 1000,
    filters: {
      tel: (value) => String(value ?? '').replace(/[^0-9+]/g, ''),
      mailbox: (value) => String(value ?? '').replace(/\s/g, ''),
    },
  })
  // Check static elements even in branches the initial scope would not visit. Dynamic elements and
  // attribute names are deliberately unsupported; expressions belong in text or quoted values.
  checkMarkup(source.replace(/{{[\s\S]*?}}/g, 'https://theme.invalid/').replace(/{%[\s\S]*?%}/g, ''), false)
  return (scope: Record<string, unknown>): string => {
    const output = compiled.render(scope)
    checkMarkup(output, true)
    return output
  }
}

/** Stored snapshots are data, not authority to introduce new slots or unbounded source. */
export function frameTemplatesOf(value: unknown): ThemeFrameTemplates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const templates: ThemeFrameTemplates = {}
  for (const slot of Object.keys(THEME_FRAME_FILES) as ThemeFrameSlot[]) {
    const source = (value as Record<string, unknown>)[slot]
    if (typeof source === 'string' && new TextEncoder().encode(source).byteLength <= THEME_LIMITS.frameBytes)
      templates[slot] = source
  }
  return templates
}

type Render = ReturnType<typeof compileThemeFrame>
// Bounded by both entries and source length. Include source in the identity so an independently
// restored tenant/version cannot reuse another snapshot's program. No request data is cached.
const cache = new Map<string, Render | null>()
export function renderThemeFrames(
  theme: SelectedTheme,
  scope: {
    site: { title: unknown; name?: unknown }
    brand: { title: unknown; logo?: string | null }
    navigation: unknown[]
    locale: string
    account: { href: string } | null
  },
): ThemeFrameTemplates {
  const rendered: ThemeFrameTemplates = {}
  const data = { ...scope, settings: theme.settings }
  for (const [name, source] of Object.entries(theme.frameTemplates ?? {})) {
    const slot = name as ThemeFrameSlot
    const key = JSON.stringify([theme.versionId, slot, source])
    let render = cache.get(key)
    if (render === undefined) {
      try {
        render = compileThemeFrame(source, slot)
      } catch {
        render = null
      }
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(key, render)
    }
    try {
      if (render) rendered[slot] = render(data)
    } catch {
      // A corrupt snapshot, invalid URL setting or exhausted loop budget keeps the native frame.
    }
  }
  return rendered
}
