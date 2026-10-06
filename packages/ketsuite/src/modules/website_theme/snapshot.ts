import { frameTemplatesOf } from './frame.ts'
import { THEME_FILE, THEME_KEY, themeAssetPath } from './types.ts'
import type { SelectedTheme } from './types.ts'

const ID = /^[A-Za-z0-9-]{1,64}$/
const ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/
const origins = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && ORIGIN.test(item))
    : []

/**
 * The theme a site appearance names, re-read defensively: the snapshot is stored JSON, and every
 * value here ends up in a URL, an attribute or a response header.
 */
export function selectedThemeOf(value: unknown): SelectedTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const theme = value as Record<string, unknown>
  if (typeof theme.key !== 'string' || !THEME_KEY.test(theme.key)) return null
  if (typeof theme.versionId !== 'string' || !ID.test(theme.versionId)) return null
  const entry =
    typeof theme.entry === 'string' && THEME_FILE.test(theme.entry) && theme.entry.endsWith('.mjs')
      ? theme.entry
      : null
  const settings: Record<string, string | boolean> = {}
  if (theme.settings && typeof theme.settings === 'object' && !Array.isArray(theme.settings))
    for (const [name, item] of Object.entries(theme.settings))
      if (typeof item === 'string' || typeof item === 'boolean') settings[name] = item
  return {
    key: theme.key,
    versionId: theme.versionId,
    version: String(theme.version ?? ''),
    entry,
    connect: origins(theme.connect),
    frame: origins(theme.frame),
    settings,
    frameTemplates: frameTemplatesOf(theme.frameTemplates),
  }
}

/**
 * The policy of a page that loads a theme. Scripts come only from this origin, which is where the
 * theme's module is served, and never inline. An explicitly configured public GTM container adds
 * Google's delivery origins. Its Custom JavaScript variables require eval (the published Inlano
 * device condition uses one); sites without GTM and staff/preview pages keep eval disabled.
 * Styles allow attributes because article markup carries alignment and image widths in them.
 */
export const themeContentSecurityPolicy = (
  theme: Pick<SelectedTheme, 'connect' | 'frame'>,
  googleTagManager = false,
): string =>
  [
    "default-src 'self'",
    googleTagManager
      ? "script-src 'self' 'unsafe-eval' https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    [
      "connect-src 'self'",
      ...theme.connect,
      ...(googleTagManager
        ? [
            'https://*.google-analytics.com',
            'https://*.analytics.google.com',
            'https://*.googletagmanager.com',
            'https://www.googleadservices.com',
            'https://googleads.g.doubleclick.net',
            'https://stats.g.doubleclick.net',
            'https://pagead2.googlesyndication.com',
            'https://www.google.com',
            'https://www.google.com.vn',
            'https://ad.doubleclick.net',
          ]
        : []),
    ].join(' '),
    `frame-src ${[...theme.frame, ...(googleTagManager ? ['https://www.googletagmanager.com'] : [])].join(' ') || "'none'"}`,
    "worker-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')

/** JSON safe to place inside a `<script type="application/json">` element. */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    // Line and paragraph separators end a line in older parsers; named by code so no build writes them out.
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')

export const themeStylesheet = (theme: SelectedTheme): string => themeAssetPath(theme.versionId, 'theme.css')
export const themeBootScript = (theme: SelectedTheme): string => themeAssetPath(theme.versionId, '_boot.mjs')
