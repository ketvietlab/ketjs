import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { THEME_ENGINE, THEME_FILE, THEME_KEY, THEME_LIMITS, THEME_VERSION, themeFileType } from './types.ts'
import type { ThemeManifest, ThemeSetting } from './types.ts'

/** One reason a package is refused. `code` is stable; `detail` names the file or field. */
export type ThemeIssue = { code: string; detail: string }

export type ThemeFileEntry = { name: string; type: string; size: number; sha256: string }

export type CheckedThemePackage =
  | { ok: true; manifest: ThemeManifest; hash: string; files: ThemeFileEntry[] }
  | { ok: false; errors: ThemeIssue[] }

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
const ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/
const SETTING_NAME = /^[a-z][A-Za-z0-9]{0,40}$/
const MANIFEST_KEYS = new Set([
  'engine',
  'key',
  'version',
  'tier',
  'title',
  'settings',
  'frame',
  'sections',
  'script',
  'fonts',
])

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

/** What the Studio calls a setting or one of its values; the theme's own words, never markup. */
const shortText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 80
const labelOf = (spec: Record<string, unknown>) =>
  spec.label !== undefined ? { label: spec.label as string } : {}
const labelsFit = (labels: unknown, values: string[]) =>
  labels === undefined ||
  (plain(labels) &&
    Object.entries(labels).every(([value, label]) => values.includes(value) && shortText(label)))

/**
 * A theme's settings schema, which replaces the fixed accent/font enums for a site using the theme.
 * Kept small and closed: a value is chosen in the Studio and lands in public markup.
 */
const checkSettings = (value: unknown, issues: ThemeIssue[]): Record<string, ThemeSetting> => {
  if (value === undefined) return {}
  if (!plain(value)) {
    issues.push({ code: 'manifestSettings', detail: 'settings' })
    return {}
  }
  const entries = Object.entries(value)
  if (entries.length > THEME_LIMITS.settings) issues.push({ code: 'manifestSettings', detail: 'settings' })
  const settings: Record<string, ThemeSetting> = {}
  for (const [name, spec] of entries) {
    const bad = () => issues.push({ code: 'manifestSettings', detail: `settings.${name}` })
    if (!SETTING_NAME.test(name) || !plain(spec) || (spec.label !== undefined && !shortText(spec.label))) {
      bad()
      continue
    }
    if (spec.type === 'enum') {
      const values = spec.values
      if (
        !strings(values) ||
        !values.length ||
        values.length > 20 ||
        values.some((item) => !/^[a-z0-9][a-z0-9-]{0,40}$/.test(item)) ||
        (spec.default !== undefined && !values.includes(spec.default as string)) ||
        !labelsFit(spec.labels, values)
      )
        bad()
      else
        settings[name] = {
          type: 'enum',
          values,
          ...(spec.default ? { default: spec.default as string } : {}),
          ...labelOf(spec),
          ...(spec.labels !== undefined ? { labels: spec.labels as Record<string, string> } : {}),
        }
    } else if (spec.type === 'text') {
      const max = spec.maxLength
      if (
        !Number.isInteger(max) ||
        (max as number) < 1 ||
        (max as number) > 500 ||
        (spec.default !== undefined &&
          (typeof spec.default !== 'string' || spec.default.length > (max as number)))
      )
        bad()
      else
        settings[name] = {
          type: 'text',
          maxLength: max as number,
          ...(spec.default !== undefined ? { default: spec.default as string } : {}),
          ...labelOf(spec),
        }
    } else if (spec.type === 'bool') {
      if (spec.default !== undefined && typeof spec.default !== 'boolean') bad()
      else
        settings[name] = {
          type: 'bool',
          ...(spec.default !== undefined ? { default: spec.default } : {}),
          ...labelOf(spec),
        }
    } else bad()
  }
  return settings
}

/**
 * The values a site keeps for a theme's settings: every declared setting resolved to a value of its
 * type, defaults filled in. Unknown names and wrong types are refused rather than dropped, so an
 * editor learns their choice did not take.
 */
export function resolveThemeSettings(
  schema: Record<string, ThemeSetting>,
  values: unknown,
): { ok: true; settings: Record<string, string | boolean> } | { ok: false; field: string } {
  const given = values == null ? {} : values
  if (!plain(given)) return { ok: false, field: 'settings' }
  for (const name of Object.keys(given)) if (!Object.hasOwn(schema, name)) return { ok: false, field: name }
  const settings: Record<string, string | boolean> = {}
  for (const [name, spec] of Object.entries(schema)) {
    const value = Object.hasOwn(given, name) ? given[name] : spec.default
    if (value === undefined) {
      if (spec.type === 'enum') settings[name] = spec.values[0]!
      else if (spec.type === 'bool') settings[name] = false
      continue
    }
    if (spec.type === 'enum' && (typeof value !== 'string' || !spec.values.includes(value)))
      return { ok: false, field: name }
    if (spec.type === 'text' && (typeof value !== 'string' || value.length > spec.maxLength))
      return { ok: false, field: name }
    if (spec.type === 'bool' && typeof value !== 'boolean') return { ok: false, field: name }
    settings[name] = value as string | boolean
  }
  return { ok: true, settings }
}

/** Validate a manifest on its own; `files` is consulted only for the names it refers to. */
export function checkThemeManifest(
  value: unknown,
  files: ReadonlySet<string>,
  issues: ThemeIssue[] = [],
): ThemeManifest | null {
  const start = issues.length
  if (!plain(value)) {
    issues.push({ code: 'manifestInvalid', detail: 'theme.json' })
    return null
  }
  for (const key of Object.keys(value))
    if (!MANIFEST_KEYS.has(key)) issues.push({ code: 'manifestUnknownKey', detail: key })
  if (value.engine !== THEME_ENGINE) issues.push({ code: 'manifestEngine', detail: String(value.engine) })
  if (typeof value.key !== 'string' || !THEME_KEY.test(value.key))
    issues.push({ code: 'manifestKey', detail: 'key' })
  if (typeof value.version !== 'string' || !THEME_VERSION.test(value.version))
    issues.push({ code: 'manifestVersion', detail: 'version' })
  // Bundled themes ship in code; the registry installs only what one company owns.
  if (value.tier !== 'private') issues.push({ code: 'manifestTier', detail: String(value.tier) })
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80)
    issues.push({ code: 'manifestTitle', detail: 'title' })
  const settings = checkSettings(value.settings, issues)
  // KTL frame slots compile at boot today; a stored template has no compiler yet (THEMES.md §5.2).
  if (value.frame !== undefined && !(Array.isArray(value.frame) && value.frame.length === 0))
    issues.push({ code: 'frameUnsupported', detail: 'frame' })
  if (value.sections !== undefined && !strings(value.sections))
    issues.push({ code: 'manifestSections', detail: 'sections' })
  const fonts = value.fonts === undefined ? [] : value.fonts
  if (!strings(fonts) || fonts.some((name) => !files.has(name) || !name.endsWith('.woff2')))
    issues.push({ code: 'manifestFonts', detail: 'fonts' })
  let script: ThemeManifest['script'] = null
  if (value.script != null) {
    const spec = value.script
    if (!plain(spec)) issues.push({ code: 'manifestScript', detail: 'script' })
    else {
      const entry = spec.entry
      const origins = (field: 'connect' | 'frame'): string[] => {
        const list = spec[field] === undefined ? [] : spec[field]
        if (!strings(list) || list.length > THEME_LIMITS.origins || list.some((item) => !ORIGIN.test(item))) {
          issues.push({ code: 'manifestOrigin', detail: `script.${field}` })
          return []
        }
        return list
      }
      const budget = spec.budgetKb === undefined ? THEME_LIMITS.scriptKb : spec.budgetKb
      if (typeof entry !== 'string' || !entry.endsWith('.mjs') || !files.has(entry))
        issues.push({ code: 'manifestScript', detail: 'script.entry' })
      if (
        !Number.isInteger(budget) ||
        (budget as number) < 1 ||
        (budget as number) > THEME_LIMITS.scriptKbMax
      )
        issues.push({ code: 'manifestScript', detail: 'script.budgetKb' })
      for (const key of Object.keys(spec))
        if (!['entry', 'connect', 'frame', 'budgetKb'].includes(key))
          issues.push({ code: 'manifestUnknownKey', detail: `script.${key}` })
      script = {
        entry: String(entry),
        connect: origins('connect'),
        frame: origins('frame'),
        budgetKb: Number(budget),
      }
    }
  }
  if (issues.length > start) return null
  return {
    engine: THEME_ENGINE,
    key: value.key as string,
    version: value.version as string,
    tier: 'private',
    title: (value.title as string).trim(),
    settings,
    sections: (value.sections as string[] | undefined) ?? [],
    script,
    fonts: fonts as string[],
  }
}

/**
 * Comments become spaces, so offsets and string contents survive. An unterminated comment would
 * swallow the rest of the file in a browser and is refused.
 */
const withoutComments = (source: string, issues: ThemeIssue[]): string => {
  let out = ''
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quote) {
      out += char
      if (char === '\\') out += source[++i] ?? ''
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
      out += char
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) {
        issues.push({ code: 'cssSyntax', detail: 'unterminated comment' })
        return out
      }
      out += ' '.repeat(end + 2 - i)
      i = end + 1
    } else out += char
  }
  return out
}

/** Split at top-level commas, outside strings, brackets and parentheses. */
const splitSelectors = (prelude: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i]!
    if (quote) {
      if (char === '\\') current += char + (prelude[++i] ?? '')
      else {
        if (char === quote) quote = ''
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  parts.push(current.trim())
  return parts
}

const GROUPING = new Set(['media', 'supports', 'container', 'layer'])

/**
 * Every rule of a theme's stylesheet must apply inside its own root, so two themes - or a theme and
 * the shared `public.css` - can never restyle each other's markup.
 *
 * This is a gate on reviewed code, not a sandbox: it refuses what would reach outside the site root
 * (`@import`, a remote or `data:` URL, an unscoped or sibling selector, a global `@property`) and
 * fails closed on anything it does not understand.
 */
export function checkThemeCss(source: string, key: string, files: ReadonlySet<string>): ThemeIssue[] {
  const issues: ThemeIssue[] = []
  const text = withoutComments(source, issues)
  const scope = new RegExp(`^\\[\\s*data-site-theme\\s*=\\s*(?:"${key}"|'${key}'|${key})\\s*\\]`)
  let i = 0
  const issue = (code: string, detail: string) => issues.push({ code, detail: detail.slice(0, 120) })

  /** Read up to the next `{`, `}` or `;` outside strings and parentheses. */
  const readPrelude = (): string => {
    const start = i
    let depth = 0
    let quote = ''
    for (; i < text.length; i++) {
      const char = text[i]!
      if (quote) {
        if (char === '\\') i++
        else if (char === quote) quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '(') depth++
      else if (char === ')') depth--
      else if (depth <= 0 && (char === '{' || char === '}' || char === ';')) break
    }
    return text.slice(start, i).trim()
  }

  const declaration = (value: string) => {
    if (!value) return
    if (/-moz-binding|\bexpression\s*\(|\bsrc\s*\(/i.test(value)) issue('cssUrl', value)
    const urls = [...value.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)]
    if ((value.match(/\burl\(/gi) ?? []).length !== urls.length) issue('cssUrl', value)
    const sets = [...value.matchAll(/image-set\(([^)]*)\)/gi)].flatMap((match) =>
      [...match[1]!.matchAll(/"([^"]*)"|'([^']*)'/g)].map((item) => item[1] ?? item[2] ?? ''),
    )
    for (const target of [...urls.map((url) => url[1] ?? url[2] ?? url[3] ?? ''), ...sets])
      if (!THEME_FILE.test(target) || !files.has(target)) issue('cssUrl', target)
  }

  const scoped = (prelude: string) => {
    for (const selector of splitSelectors(prelude)) {
      const match = scope.exec(selector)
      const rest = match ? selector.slice(match[0].length) : ''
      // `[root] + x` and `[root] ~ x` style what follows the root, which is outside it.
      if (!match || (rest && !/^[\s.#[:>]/.test(rest)) || /^\s*[+~]/.test(rest)) issue('cssScope', selector)
    }
  }

  const nested = (prelude: string) => {
    for (const selector of splitSelectors(prelude))
      if (/&\s*[+~]/.test(selector) || /^\s*[+~]/.test(selector)) issue('cssScope', selector)
  }

  type Kind = 'top' | 'group' | 'style' | 'decls' | 'keyframes'
  const block = (kind: Kind): void => {
    while (i < text.length) {
      const prelude = readPrelude()
      const char = text[i]
      if (char === undefined) break
      i++
      if (char === '}') {
        if (kind === 'top') issue('cssSyntax', 'unbalanced }')
        else {
          if (kind === 'style' || kind === 'decls') declaration(prelude)
          else if (prelude) issue('cssSyntax', prelude)
          return
        }
        continue
      }
      if (char === ';') {
        if (prelude.startsWith('@')) {
          const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? ''
          if (name === 'import') issue('cssImport', prelude)
          else if (!(name === 'charset' && kind === 'top') && name !== 'layer') issue('cssAtRule', prelude)
        } else if (kind === 'style' || kind === 'decls') declaration(prelude)
        else if (prelude) issue('cssSyntax', prelude)
        continue
      }
      // An opening brace: what kind of block it opens depends on where it is.
      if (prelude.startsWith('@')) {
        const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? ''
        if (GROUPING.has(name)) block(kind === 'style' ? 'style' : kind === 'decls' ? 'decls' : 'group')
        else if (name === 'font-face' && (kind === 'top' || kind === 'group')) block('decls')
        else if (
          (name === 'keyframes' || name === '-webkit-keyframes') &&
          (kind === 'top' || kind === 'group')
        ) {
          // Animation names are global; a prefix keeps one theme from replacing another's.
          if (
            !prelude
              .slice(name.length + 1)
              .trim()
              .startsWith(`${key}-`)
          )
            issue('cssKeyframes', prelude)
          block('keyframes')
        } else {
          issue('cssAtRule', prelude)
          block('decls')
        }
      } else if (kind === 'keyframes') block('decls')
      else if (kind === 'top' || kind === 'group') {
        scoped(prelude)
        block('style')
      } else if (kind === 'style') {
        nested(prelude)
        block('style')
      } else {
        issue('cssSyntax', prelude)
        block('decls')
      }
    }
    if (kind !== 'top') issue('cssSyntax', 'unbalanced {')
  }
  block('top')
  return issues
}

/**
 * Check a whole package as uploaded: names, types, sizes, manifest, stylesheet and script budget.
 * The hash covers every file, so two installs of the same bytes are recognisably the same version.
 */
export function checkThemePackage(files: Record<string, Uint8Array>): CheckedThemePackage {
  const issues: ThemeIssue[] = []
  const names = Object.keys(files).sort()
  const known = new Set(names)
  if (names.length > THEME_LIMITS.files)
    issues.push({ code: 'packageTooLarge', detail: `${names.length} files` })
  let total = 0
  const entries: ThemeFileEntry[] = []
  for (const name of names) {
    const bytes = files[name]!
    const type = themeFileType(name)
    if (!THEME_FILE.test(name)) issues.push({ code: 'fileName', detail: name })
    else if (!type) issues.push({ code: 'fileType', detail: name })
    if (bytes.byteLength > THEME_LIMITS.fileBytes) issues.push({ code: 'fileTooLarge', detail: name })
    total += bytes.byteLength
    entries.push({
      name,
      type: type ?? 'application/octet-stream',
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })
  }
  if (total > THEME_LIMITS.totalBytes) issues.push({ code: 'packageTooLarge', detail: `${total} bytes` })
  if (!known.has('theme.json')) issues.push({ code: 'manifestMissing', detail: 'theme.json' })
  if (!known.has('theme.css')) issues.push({ code: 'stylesheetMissing', detail: 'theme.css' })
  let manifest: ThemeManifest | null = null
  if (known.has('theme.json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['theme.json']))
    } catch {
      issues.push({ code: 'manifestInvalid', detail: 'theme.json' })
    }
    if (parsed !== undefined) manifest = checkThemeManifest(parsed, known, issues)
  }
  const css = names.filter((name) => name.endsWith('.css'))
  if (manifest)
    for (const name of css) {
      let source = ''
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(files[name])
      } catch {
        issues.push({ code: 'cssSyntax', detail: name })
        continue
      }
      issues.push(...checkThemeCss(source, manifest.key, known))
    }
  const modules = names.filter((name) => name.endsWith('.mjs'))
  if (manifest && modules.length && !manifest.script)
    issues.push({ code: 'scriptUndeclared', detail: modules[0]! })
  if (manifest?.script) {
    const gzipped = modules.reduce((sum, name) => sum + gzipSync(files[name]!).byteLength, 0)
    if (gzipped > manifest.script.budgetKb * 1024)
      issues.push({ code: 'scriptBudget', detail: `${Math.ceil(gzipped / 1024)} KB` })
  }
  if (issues.length || !manifest) return { ok: false, errors: issues }
  const hash = sha256(entries.map((file) => `${file.name}\0${file.size}\0${file.sha256}\n`).join(''))
  return { ok: true, manifest, hash, files: entries }
}
