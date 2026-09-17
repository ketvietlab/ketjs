import type { Ctx } from '@ketvietlab/ketjs'

type Lang = 'vi' | 'en'

/**
 * Tabs other modules add to the template record modal, from the fills of
 * `product_backend:template.recordTabs`. A client modal cannot render a joint, so
 * it places the island itself; only an island fill can cross.
 */
export const recordTabsFor = (
  ctx: Pick<Ctx, 'manifest'>,
  lang: Lang,
): Array<{ id: string; label: string; island: string }> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const message = (key: string): string | null => {
    const value = catalog[key]
    if (value === undefined) return null
    return typeof value === 'string' ? value : String(value.other ?? Object.values(value)[0] ?? key)
  }
  return ctx.manifest.fills
    .filter((fill) => fill.joint === 'product_backend:template.recordTabs')
    .flatMap((fill) => {
      const island = /\{%\s*island\s+"([^"]+)"\s*%\}/u.exec(fill.template)?.[1]
      if (!island) return []
      return [{ id: fill.by, label: message(`${fill.by}.productTemplateTab`) ?? fill.by, island }]
    })
}
