/**
 * The registry's fixed vocabulary, shared by install, selection, delivery and the public renderer.
 *
 * A theme version is an immutable, flat set of files. Flat because KetJS routes take single-segment
 * parameters, and because a namespace without directories cannot be walked out of.
 */

export const THEME_ENGINE = 'website-theme/1'

/** A file of a theme package. It never starts with `_`, which leaves `_boot.mjs` to the route. */
export const THEME_FILE = /^[a-z0-9][a-z0-9._-]{0,80}$/
export const THEME_KEY = /^[a-z][a-z0-9-]{1,40}$/
export const THEME_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/
/** The module the route generates for a version with a script; see `boot.ts`. */
export const THEME_BOOT_FILE = '_boot.mjs'

export const THEME_LIMITS = {
  files: 200,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 10 * 1024 * 1024,
  /** The gzip budget of a module when its manifest names none, and the most it may name. */
  scriptKb: 120,
  scriptKbMax: 256,
  settings: 40,
  origins: 10,
} as const

/** What the route answers each file with, by extension. Anything else is refused at install. */
export const THEME_TYPES: Record<string, string> = {
  json: 'application/json',
  css: 'text/css; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  woff2: 'font/woff2',
}

export const themeFileType = (name: string): string | null =>
  THEME_TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? null

/** `installed` is stored but offered to nobody; only `available` is selectable and served. */
export const THEME_STATUSES = ['staged', 'installed', 'available', 'revoked'] as const
export type ThemeStatus = (typeof THEME_STATUSES)[number]

/** A setting the Studio offers for a theme. `label` and enum `labels` are how the Studio names them. */
export type ThemeSetting =
  | { type: 'enum'; values: string[]; default?: string; label?: string; labels?: Record<string, string> }
  | { type: 'text'; maxLength: number; default?: string; label?: string }
  | { type: 'bool'; default?: boolean; label?: string }

export type ThemeManifest = {
  engine: typeof THEME_ENGINE
  key: string
  version: string
  tier: 'private'
  title: string
  settings: Record<string, ThemeSetting>
  sections: string[]
  script: { entry: string; connect: string[]; frame: string[]; budgetKb: number } | null
  fonts: string[]
}

/**
 * What a site's live style holds once a theme is selected.
 *
 * Everything the public renderer needs is here, because it renders synchronously from the snapshot
 * and cannot look the version up.
 */
export type SelectedTheme = {
  key: string
  versionId: string
  version: string
  entry: string | null
  connect: string[]
  frame: string[]
  settings: Record<string, string | boolean>
}

/** Where a version's files live in the tenant's storage, whichever driver backs it. */
export const themeStoragePrefix = (key: string, versionId: string): string =>
  `website-theme/${key}/${versionId}/`

/** The same-origin path a page loads a version's file from. */
export const themeAssetPath = (versionId: string, file: string): string =>
  `/_theme/${encodeURIComponent(versionId)}/${file}`
