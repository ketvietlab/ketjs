// The declaration surface. Everything a module contributes is declared here and
// nowhere else: no side-channel registration, no import-time magic, nothing that
// depends on a file's name or location.

import { KetError } from './errors.ts'
import type { KetModule, ModuleSpec } from '../types.ts'

const MODULE_KEYS = new Set([
  'name', 'version', 'depends', 'models', 'extend', 'joints', 'fills',
  'functions', 'views', 'requires', 'tokens', 'templates', 'provides', 'kind', 'islands', 'sections', 'relations',
  'app', 'title', 'summary', 'category', 'install', 'autoInstall', 'messages',
])

export function defineModule(spec: ModuleSpec): KetModule {
  if (!spec || typeof spec !== 'object') throw new KetError({ code: 'E_MODULE_SHAPE', message: 'defineModule() expects an object' })
  if (typeof spec.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(spec.name)) {
    throw new KetError({
      code: 'E_MODULE_NAME',
      message: `invalid module name ${JSON.stringify(spec.name)}`,
      hint: 'use lowercase letters, digits and underscore, starting with a letter',
    })
  }
  for (const k of Object.keys(spec)) {
    if (!MODULE_KEYS.has(k)) {
      throw new KetError({
        code: 'E_MODULE_UNKNOWN_KEY',
        module: spec.name,
        message: `module "${spec.name}" declares unknown key "${k}"`,
        hint: `known keys: ${[...MODULE_KEYS].join(', ')}`,
      })
    }
  }
  return Object.freeze({
    kind: spec.kind ?? 'module',
    name: spec.name,
    version: spec.version ?? '0.0.0',
    depends: Object.freeze([...(spec.depends ?? [])]),
    models: spec.models ?? {},
    extend: spec.extend ?? {},
    joints: spec.joints ?? {},
    fills: spec.fills ?? {},
    functions: spec.functions ?? {},
    views: spec.views ?? {},
    requires: Object.freeze([...(spec.requires ?? [])]),
    tokens: spec.tokens ?? {},
    templates: spec.templates ?? {},
    provides: Object.freeze([...(spec.provides ?? [])]),
    islands: spec.islands ?? {},
    sections: spec.sections ?? {},
    relations: spec.relations ?? {},
    app: spec.app === true,
    title: spec.title ?? spec.name,
    summary: spec.summary ?? '',
    category: spec.category ?? 'Khác',
    install: spec.install ?? (spec.autoInstall === true ? 'auto' : 'manual'),
    messages: spec.messages ?? {},
  })
}

// A theme is a module with a restricted role. It may provide templates, fill
// joints and declare tokens; it may NOT declare models, extend models, or register
// server functions. Third-party themes are only safe to install because this
// restriction is enforced here rather than left to convention.
const THEME_FORBIDDEN = ['models', 'extend', 'functions', 'islands'] as const

/**
 * A theme is installable like anything else — it has to be, since its templates are
 * what a page renders through. So it defaults to appearing in the app list under its
 * own category: a theme nobody can switch on is a theme nobody can use.
 */
export function defineTheme(spec: ModuleSpec): KetModule {
  for (const k of THEME_FORBIDDEN) {
    const v = spec[k]
    if (v && Object.keys(v).length > 0) {
      throw new KetError({
        code: 'E_THEME_OVERREACH',
        module: spec.name,
        message: `theme "${spec.name}" declares "${k}", which themes are not allowed to do`,
        hint: k === 'islands'
          ? 'a theme places an island with {% island "name" %} but never defines one — move it into a module'
          : `themes may only declare: templates, provides, fills, tokens, requires. Move "${k}" into a module.`,
      })
    }
  }
  return defineModule({ app: true, category: 'Giao diện', ...spec, kind: 'theme' })
}
