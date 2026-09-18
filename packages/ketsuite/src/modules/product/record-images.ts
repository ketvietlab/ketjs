// The images a product record modal shows, read without depending on product_media.
//
// `product` does not depend on `product_media` — the gallery is an optional module —
// so these read its table only when the deployment composed it, the same way the
// modal context asks whether `stock` or `account` are installed before touching them.

import type { Ctx, Row } from '@ketvietlab/ketjs'

export type RecordImage = { mediaId: string; attachmentId: string; alt: string | null; primary: boolean }

export const hasProductMedia = (ctx: Ctx): boolean => Boolean(ctx.manifest.models['product_media.Media'])

const imageOf = (row: Row): RecordImage => ({
  mediaId: String(row.id),
  attachmentId: String(row.attachmentId),
  alt: row.alt == null ? null : String(row.alt),
  primary: row.primary === true,
})

/** Primary first, then gallery order: the first image is the one a thumbnail shows. */
const ordered = (rows: Row[]): RecordImage[] =>
  rows
    .sort(
      (a, b) =>
        Number(b.primary === true) - Number(a.primary === true) ||
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map(imageOf)

export const templateImagesOf = async (ctx: Ctx, templateId: string): Promise<RecordImage[]> =>
  hasProductMedia(ctx) ? ordered(await ctx.db.select('product_media.Media', { templateId })) : []

/** Every variant's images at once, by product id — one read for the whole editor. */
export const variantImagesOf = async (
  ctx: Ctx,
  productIds: readonly string[],
): Promise<Map<string, RecordImage[]>> => {
  const out = new Map<string, RecordImage[]>()
  if (!hasProductMedia(ctx) || !productIds.length) return out
  const wanted = new Set(productIds)
  const byProduct = new Map<string, Row[]>()
  for (const row of await ctx.db.select('product_media.Media')) {
    const productId = row.productId == null ? null : String(row.productId)
    if (!productId || !wanted.has(productId)) continue
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), row])
  }
  for (const [productId, rows] of byProduct) out.set(productId, ordered(rows))
  return out
}
