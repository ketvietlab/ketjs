import type { Ctx, Row, SectionDef } from '@ketvietlab/ketjs'
import { nodes, publicBinding } from './helpers.ts'

export const catalogSections: Record<string, SectionDef> = {
  'website_catalog.product_card': {
    title: 'Sản phẩm liên kết',
    settings: { productId: 'id', ctaLabel: 'text?', imageFit: 'text?' },
    resolve: 'website_catalog.cardData',
  },
}
export async function cardData(ctx: Ctx, siteId: unknown, settings: Row): Promise<Row | null> {
  const b = (await ctx.db.select('website_catalog.Binding', { siteId, productId: settings.productId }))[0]
  return b ? publicBinding(ctx, b) : null
}
export async function cardDataForLayout(ctx: Ctx, siteId: unknown, layout: unknown) {
  const data: Record<string, Row | null> = {},
    cache = new Map<unknown, Row | null>()
  for (const n of nodes(layout).values()) {
    if (n.type !== 'website_catalog.product_card') continue
    if (!cache.has(n.settings.productId))
      cache.set(n.settings.productId, await cardData(ctx, siteId, n.settings))
    data[n.id] = cache.get(n.settings.productId) ?? null
  }
  return data
}
/** Persist only the product reference; reuse the existing card markup at public read time. */
export async function materializeCards(ctx: Ctx, siteId: unknown, raw: unknown): Promise<Row[]> {
  const layout = structuredClone(raw) as Row[],
    data = await cardDataForLayout(ctx, siteId, layout)
  const walk = (items: Row[]): Row[] =>
    items.flatMap((n) => {
      if (n.type === 'website_catalog.product_card') {
        const p = data[String(n.id)]
        if (!p) return []
        const image = (p.gallery as Row[])[0]?.src
        return [
          ...(image
            ? [
                {
                  id: `${n.id}-image`,
                  type: 'website.image',
                  settings: { image, alt: p.name, imageFit: (n.settings as Row).imageFit ?? 'contain' },
                },
              ]
            : []),
          {
            id: n.id,
            type: 'website.callout',
            settings: {
              heading: p.name,
              body: p.description,
              ctaLabel: (n.settings as Row).ctaLabel ?? 'Xem chi tiết',
              ctaHref: p.path,
            },
          },
        ]
      }
      if (n.slots)
        n.slots = Object.fromEntries(
          Object.entries(n.slots as Record<string, Row[]>).map(([slot, children]) => [slot, walk(children)]),
        )
      if (
        n.type === 'website.columns' &&
        Object.values(n.slots as Record<string, Row[]>).every((children) => !children.length)
      )
        return []
      return [n]
    })
  return walk(layout)
}
