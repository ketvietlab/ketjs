// What a set of functions opens, screen by screen and area by area.
//
// Shared by the user and role record-modal contexts: a person is measured by what
// they effectively hold where they land, a role template by what it grants. Both
// answer the same question the same way, so the two modals never disagree.

import type { Ctx, Row } from '@ketvietlab/ketjs'
import { permissionArea, permissionGroupOrder } from './permission-areas.ts'

type Lang = 'vi' | 'en'
type CatalogueContext = Pick<Ctx, 'manifest'>

/** One message in the reader's language, or null when the catalogue does not have it. */
export const messageOf = (ctx: CatalogueContext, lang: Lang, key: string): string | null => {
  const message = ctx.manifest.messages?.[lang]?.[key]
  if (message == null) return null
  return typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
}

/** What a function is part of, in words: the first bundle that carries it. */
export const functionLabel = (ctx: CatalogueContext, lang: Lang, fn: string): string => {
  const bundle = ctx.manifest.permissions.functions[fn]?.bundles[0]
  return (
    (bundle && ctx.manifest.permissions.bundles[bundle]?.labels[lang]) ||
    (lang === 'vi' ? 'Chức năng chưa có tên' : 'Unnamed capability')
  )
}

/**
 * Every screen `holds` opens, one row per menu entry.
 *
 * A screen opens on its menu's `needs`; required reads are declared separately
 * in `requires`. Optional work in `for` never implies broken access. A screen that opens without its required reads is the
 * one that fails in front of someone, so it says what is missing and which role
 * templates would cover all of it. Screens that do not open are left out.
 */
export const surfaceRows = (
  ctx: CatalogueContext,
  lang: Lang,
  holds: (fn: string) => boolean,
  via: (fn: string) => string[] = () => [],
): Row[] => {
  const menus = ctx.manifest.menus ?? {}
  const label = (def: { by: string; label: string }): string =>
    messageOf(ctx, lang, `${def.by}.${def.label}`) ?? messageOf(ctx, lang, def.label) ?? def.label
  const templates = Object.values(ctx.manifest.permissions.roleTemplates)
  return Object.entries(menus)
    .filter(([, def]) => def.path && def.needs && ctx.manifest.functions[def.needs] && holds(def.needs))
    .map(([key, def]): Row => {
      const work = [...new Set([String(def.needs), ...(def.requires ?? [])])]
      const missing = work.filter((fn) => !holds(fn))
      const parent = def.parent ? menus[def.parent] : undefined
      return {
        key,
        label: label(def),
        area: parent ? label(parent) : '',
        // The module that placed the screen, so it can be read under its permission area.
        module: String(def.by ?? ''),
        status: missing.length ? 'partial' : 'full',
        missing: missing.map((fn) => ({
          key: fn,
          label: functionLabel(ctx, lang, fn),
          tier: ctx.manifest.permissions.functions[fn]?.risk === 'read' ? 'read' : 'write',
        })),
        via: via(String(def.needs)),
        fixes: missing.length
          ? templates
              .filter(
                (template) =>
                  missing.every((fn) => template.functions.includes(fn)) &&
                  // A suggestion must not grant unrelated or security authority.
                  template.functions.every(
                    (fn) =>
                      (holds(fn) || missing.includes(fn)) &&
                      ctx.manifest.permissions.functions[fn]?.risk !== 'security',
                  ),
              )
              .map((template) => template.labels[lang])
              .slice(0, 3)
          : [],
      }
    })
    .sort(
      (a, b) =>
        Number(a.status === 'full') - Number(b.status === 'full') ||
        String(a.area).localeCompare(String(b.area)) ||
        String(a.label).localeCompare(String(b.label)),
    )
}

/**
 * Whether a role template hands out authority over authority.
 *
 * A template holding any security-risk function — assigning roles, minting
 * credentials, changing who may do what — is marked, so a form can say which
 * roles only a superuser may give.
 */
export const templateTier = (ctx: CatalogueContext, templateKey: string): 'security' | 'standard' => {
  const template = ctx.manifest.permissions.roleTemplates[templateKey]
  return template?.functions.some((fn) => ctx.manifest.permissions.functions[fn]?.risk === 'security')
    ? 'security'
    : 'standard'
}

/**
 * How far a function reaches, on the four-step scale an administrator reads:
 * see, create and change, run the area. Reading private data is still reading;
 * approving, configuring and security run the area.
 */
const RISK_LEVEL: Record<string, 1 | 2 | 3> = {
  read: 1,
  sensitive: 1,
  operate: 2,
  approve: 3,
  configure: 3,
  security: 3,
}
const LEVELS = ['none', 'view', 'edit', 'manage'] as const

/** The area a module's bundles and screens are read under: `sale_backend` is Sales. */
export const areaKey = (module: string): string =>
  module.endsWith('_backend') ? module.slice(0, -8) : module

/**
 * What this person can do, area by area, on four levels.
 *
 * An area reaches the highest level of any function it holds there; it is
 * partial when functions of that level are only partly held, which is what a
 * "why can't they" call is about. Each area names the held roles that give it, and
 * the areas held nothing of are named apart, so the list says what someone does
 * rather than everything they don't.
 */
export const accessAreas = (
  ctx: CatalogueContext,
  lang: Lang,
  holds: (fn: string) => boolean,
  via: (fn: string) => string[],
): { areas: Row[]; without: string[] } => {
  const catalogue = ctx.manifest.permissions
  const modules = new Map<string, Set<string>>()
  for (const [key, bundle] of Object.entries(catalogue.bundles ?? {})) {
    const dot = key.indexOf('.')
    const module = areaKey(dot > 0 ? key.slice(0, dot) : key)
    const functions = modules.get(module) ?? new Set<string>()
    for (const fn of (bundle as { functions?: string[] }).functions ?? []) functions.add(fn)
    if (functions.size) modules.set(module, functions)
  }
  type Ranked = { group: number; label: string }
  const areas: (Ranked & Row)[] = []
  const without: Ranked[] = []
  for (const [module, functions] of modules) {
    const named = permissionArea(module, lang)
    const group = permissionGroupOrder.indexOf(named.group)
    const levelOf = (fn: string): number => RISK_LEVEL[String(catalogue.functions[fn]?.risk)] ?? 2
    const held = [...functions].filter(holds)
    const level = Math.max(0, ...held.map(levelOf))
    if (!level) {
      without.push({ group, label: named.label })
      continue
    }
    areas.push({
      key: module,
      label: named.label,
      group,
      level: LEVELS[level],
      partial: [...functions].some((fn) => levelOf(fn) === level && !holds(fn)),
      via: [...new Set(held.flatMap(via))].sort((a, b) => a.localeCompare(b)),
    })
  }
  const order = (a: Ranked, b: Ranked) => a.group - b.group || a.label.localeCompare(b.label)
  return { areas: areas.sort(order), without: without.sort(order).map((row) => row.label) }
}
