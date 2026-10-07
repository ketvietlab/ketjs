import { randomUUID } from 'node:crypto'
import { asc, deleteFrom, eq, from, inArray, KetError, validateLayout } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
type SectionPlacement = {
  id: string
  type: string
  settings: Row
  slots?: Record<string, SectionPlacement[]>
}
import { canAccessSite, canManageStructure } from '../website/access.ts'
import { liveDocument } from '../../ui/live-document.ts'

export const readModels = [
  'website.Site',
  'website.SiteMember',
  'product.Template',
  'product.Product',
  'product.Category',
  'product.Brand',
  'product_media.Media',
  'storage.Attachment',
  'website_catalog.Template',
  'website_catalog.Binding',
  'website_catalog.Category',
  'website_catalog.Membership',
  'website_catalog.Redirect',
  'website_catalog.Upload',
  'website_menu.Menu',
  'website_menu.MenuItem',
]
export const readEffects = readModels.map((m) => `read:${m}`)
export const writeEffects = [
  ...readEffects,
  ...[
    'website_catalog.Template',
    'website_catalog.Binding',
    'website_catalog.Category',
    'website_catalog.Membership',
    'website_catalog.Redirect',
    'website_catalog.Upload',
    'storage.Attachment',
    'website_menu.Menu',
    'website_menu.MenuItem',
  ].map((m) => `write:${m}`),
]
export const object = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
export const parse = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v)
export const fail = (message: string, code = 'validation'): never => {
  throw new KetError({ code, message })
}
export const ids = (v: unknown): string[] => {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > 20_000 || v.some((x) => typeof x !== 'string'))
    fail('Danh sách sản phẩm không hợp lệ.')
  return [...new Set(v as string[])]
}
export async function site(ctx: Ctx, siteId: unknown, write = false, publicRead = false): Promise<Row> {
  const found = (await ctx.db.select('website.Site', { id: siteId }))[0]
  if (!found || (publicRead && !found.active)) fail('Không tìm thấy website.', 'notFound')
  if (!publicRead && !(await (write ? canManageStructure : canAccessSite)(ctx, siteId)))
    fail('Forbidden: Không có quyền trên website.', 'forbidden')
  return found!
}
export async function scoped(ctx: Ctx, model: string, siteId: unknown, id: unknown): Promise<Row> {
  const found = (await ctx.db.select(model, { id, siteId }))[0]
  if (!found) fail('Không tìm thấy bản ghi.', 'notFound')
  return found!
}
export async function replace(ctx: Ctx, model: string, current: Row, expected: unknown, patch: Row) {
  if (expected !== current.revisionId)
    fail('Conflict: Dữ liệu đã thay đổi. Tải lại trước khi lưu.', 'conflict')
  const result = await ctx.db.compareAndSet(
    model,
    { id: current.id, siteId: current.siteId },
    { revisionId: current.revisionId },
    { ...patch, revisionId: randomUUID() },
  )
  if ('matched' in result && !result.matched) fail('Conflict: Dữ liệu đã thay đổi.', 'conflict')
}
export function pathOf(value: unknown): string {
  const path = String(value ?? '').trim()
  if (
    !/^\/(?:[\p{L}\p{N}_~-]+\/?)*$/u.test(path) ||
    path.length > 240 ||
    path === '/' ||
    /^\/(website|files|api)(\/|$)/.test(path)
  )
    fail('Đường dẫn không hợp lệ.')
  return path.replace(/\/$/, '')
}
export const slugOf = (name: unknown) =>
  String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
export const docOf = (text: unknown) =>
  JSON.stringify([{ id: 'body', type: 'p', delta: [{ insert: String(text ?? '') }] }])
export async function source(ctx: Ctx, id: unknown): Promise<Row> {
  const p = (await ctx.db.select('product.Template', { id }))[0]
  if (!p) fail('Không tìm thấy sản phẩm.', 'notFound')
  const category = p!.categoryId ? (await ctx.db.select('product.Category', { id: p!.categoryId }))[0] : null
  const brand = p!.brandId ? (await ctx.db.select('product.Brand', { id: p!.brandId }))[0] : null
  const M = ctx.table('product_media.Media')
  const media = await ctx.db.all(from(M).where(eq(M.templateId, id)).orderBy(asc(M.sequence)).limit(100))
  const gallery: Row[] = []
  for (const m of media.filter((m) => !m.role || m.role === 'overview')) {
    const a = (await ctx.db.select('storage.Attachment', { id: m.attachmentId }))[0]
    if (
      a?.public &&
      a.resModel === 'product.Template' &&
      a.resId === id &&
      /^image\/(png|jpeg|webp|avif)$/.test(String(a.mimetype))
    )
      gallery.push({ src: `/website/catalog/files/${a.id}`, alt: m.alt ?? a.name })
  }
  const variants = await ctx.db.select('product.Product', { templateId: id })
  return {
    id: p!.id,
    name: p!.name,
    type: p!.type,
    description: p!.description ?? '',
    summaryDoc:
      typeof p!.summaryDoc === 'string'
        ? p!.summaryDoc
        : p!.summaryDoc
          ? JSON.stringify(p!.summaryDoc)
          : docOf(p!.description),
    descriptionDoc:
      typeof p!.descriptionDoc === 'string'
        ? p!.descriptionDoc
        : p!.descriptionDoc
          ? JSON.stringify(p!.descriptionDoc)
          : '[]',
    gallery,
    category: category?.name ?? '',
    categoryId: p!.categoryId ?? '',
    brand: brand?.name ?? '',
    brandId: p!.brandId ?? '',
    sku: variants.find((v) => v.active !== false)?.defaultCode ?? '',
    variantId: variants.find((v) => v.active !== false)?.id ?? null,
    active: p!.active,
    revisionId: p!.revisionId ?? 'initial',
  }
}
export const effective = (p: Row, b: Row): Row => ({
  ...p,
  ...object(b.overrides),
  websiteContent: object(b.overrides).contentLayout ?? b.contentLayout ?? [],
})
export const bindingFields: Record<string, string> = {
  'product.name': 'heading',
  'product.summaryDoc': 'bodyDoc',
  'product.descriptionDoc': 'bodyDoc',
  'product.gallery': 'images',
}
export function nodes(layout: unknown): Map<string, SectionPlacement> {
  const result = new Map<string, SectionPlacement>()
  const walk = (items: SectionPlacement[]) => {
    for (const n of items) {
      if (!n.id || result.has(n.id)) fail('Block ID không hợp lệ hoặc trùng.')
      result.set(n.id, n)
      for (const children of Object.values(n.slots ?? {})) walk(children)
    }
  }
  if (!Array.isArray(layout)) fail('Bố cục không hợp lệ.')
  walk(layout as SectionPlacement[])
  return result
}
export function bound(t: Row, p: Row): SectionPlacement[] {
  if (p.type !== t.productType) fail('Loại sản phẩm không khớp template.')
  const layout = structuredClone(parse(t.layout)) as SectionPlacement[],
    map = nodes(layout)
  for (const b of parse(t.bindings) as Row[]) {
    const n = map.get(String(b.nodeId)),
      key = bindingFields[String(b.field)]
    if (!n || !key || n.type !== (key === 'images' ? 'website.gallery' : 'website.rich_text'))
      fail('Liên kết nội dung không hợp lệ.')
    n!.settings = {
      ...n!.settings,
      [key]: key === 'images' ? JSON.stringify(p.gallery) : p[String(b.field).slice(8)],
    }
    if (key === 'bodyDoc') n!.settings.body = ''
  }
  return [
    ...layout,
    ...(Array.isArray(p.websiteContent) ? (structuredClone(p.websiteContent) as SectionPlacement[]) : []),
  ]
}
export function checkLayout(ctx: Ctx, layout: unknown) {
  if (Buffer.byteLength(JSON.stringify(layout)) > 900_000) fail('Bố cục quá lớn.')
  const valid = validateLayout(ctx.manifest, layout)
  if (!valid.ok) fail(`Bố cục không hợp lệ: ${JSON.stringify(valid.errors)}`)
  for (const n of nodes(layout).values())
    if (n.type === 'website.rich_text' && n.settings?.bodyDoc) {
      const doc = liveDocument(n.settings.bodyDoc, { images: false })
      n.settings = { ...n.settings, bodyDoc: doc.doc, body: doc.text }
    }
}
export async function bindingRow(ctx: Ctx, b: Row): Promise<Row> {
  const p = await source(ctx, b.productId),
    categories = await ctx.db.select('website_catalog.Category', {
      siteId: b.siteId,
      kind: 'category',
      archived: false,
    })
  const memberships = await ctx.db.select('website_catalog.Membership', {
    siteId: b.siteId,
    productId: b.productId,
    excluded: false,
  })
  const templates = await ctx.db.select('website_catalog.Template', { siteId: b.siteId, productType: p.type })
  return {
    ...b,
    product: p,
    effectiveProduct: effective(p, b),
    sourceEditorHref: `/admin/product/templates/${p.id}`,
    templates: templates.map((t) => ({ id: t.id, title: t.title })),
    categoryIds: memberships
      .filter((m) => categories.some((c) => c.id === m.categoryId))
      .map((m) => m.categoryId),
    categoryChoices: categories.map((c) => ({ id: c.id, title: c.title, path: [] })),
  }
}
export async function validateImages(
  ctx: Ctx,
  siteId: unknown,
  model: string,
  ownerId: unknown,
  gallery: unknown,
): Promise<void> {
  if (!Array.isArray(gallery) || gallery.length > 100) fail('Ảnh không hợp lệ.')
  for (const raw of gallery as unknown[]) {
    const image = object(raw),
      match = /^\/website\/catalog\/files\/([\w-]+)$/.exec(String(image.src ?? ''))
    if (!match || (image.alt != null && typeof image.alt !== 'string'))
      fail('Ảnh phải thuộc website hoặc sản phẩm nguồn.')
    const a = (await ctx.db.select('storage.Attachment', { id: match![1] }))[0]
    const upload = (
      await ctx.db.select('website_catalog.Upload', { id: match![1], siteId, resModel: model, ownerId })
    )[0]
    const siteMedia = a?.public && a.resModel === 'website.Site' && a.resId === siteId
    const sourceMedia =
      a?.public &&
      a.resModel === 'product.Template' &&
      (await ctx.db.select('website_catalog.Binding', { siteId, productId: a.resId })).length > 0
    if (
      !a ||
      !/^image\/(png|jpeg|webp|avif)$/.test(String(a.mimetype)) ||
      (!sourceMedia &&
        !siteMedia &&
        (upload?.deleting || !upload?.ready || (!upload.claimed && upload.actorId !== ctx.actor)))
    )
      fail('Ảnh không thuộc nội dung đang sửa.')
    if (upload && !upload.claimed) {
      if (new Date(String(upload.expiresAt)).getTime() < Date.now()) fail('Ảnh hết hạn.')
      const claim = await ctx.db.compareAndSet(
        'website_catalog.Upload',
        { id: a.id },
        { ready: true, claimed: false, deleting: upload.deleting ?? null },
        { claimed: true },
      )
      if ('matched' in claim && !claim.matched) fail('Ảnh hết hạn hoặc đã thay đổi.')
      await ctx.db.update('storage.Attachment', { id: a.id }, { public: true })
    }
  }
}
export async function publicBinding(ctx: Ctx, b: Row): Promise<Row | null> {
  if (!b.visible) return null
  const p = await source(ctx, b.productId)
  if (!p.active || !p.variantId) return null
  const v = b.variantId
    ? (await ctx.db.select('product.Product', { id: b.variantId, templateId: b.productId }))[0]
    : null
  if (b.variantId && !v?.active) return null
  return { ...effective(p, b), path: b.path, bindingId: b.id, visible: true }
}
export async function categoryIds(ctx: Ctx, category: Row, publicRead = false): Promise<string[]> {
  const all = await ctx.db.select('website_catalog.Category', { siteId: category.siteId, archived: false })
  if (publicRead) {
    let cursor: Row | undefined = category
    const seen = new Set<unknown>()
    while (cursor) {
      if (!cursor.visible || seen.has(cursor.id)) return []
      seen.add(cursor.id)
      cursor = cursor.parentId ? all.find((r) => r.id === cursor!.parentId) : undefined
    }
  }
  const catIds = [String(category.id)]
  if (category.includeChildren) {
    for (let i = 0; i < catIds.length; i++)
      for (const child of all)
        if (
          child.parentId === catIds[i] &&
          (!publicRead || child.visible) &&
          !catIds.includes(String(child.id))
        )
          catIds.push(String(child.id))
  }
  const M = ctx.table('website_catalog.Membership')
  const members = await ctx.db.all(
    from(M).where(eq(M.siteId, category.siteId), inArray(M.categoryId, catIds)).orderBy(asc(M.position)),
  )
  let selected = members.filter((m) => !m.excluded).map((m) => String(m.productId))
  if (category.kind === 'collection' && category.mode === 'rules') {
    const T = ctx.table('product.Template')
    let q = from(T).where(eq(T.active, true)).select(T.id)
    if (category.ruleGroup) q = q.where(eq(T.categoryId, category.ruleGroup))
    if (category.ruleType) q = q.where(eq(T.type, category.ruleType))
    const rule = await ctx.db.all(q.orderBy(asc(T.name)))
    selected.push(...rule.map((p) => String(p.id)))
  }
  const excluded = new Set(members.filter((m) => m.excluded).map((m) => m.productId))
  return [...new Set(selected)].filter((id) => !excluded.has(id))
}

export async function deleteRows(ctx: Ctx, model: string, where: Row) {
  const T = ctx.table(model)
  return ctx.db.del(deleteFrom(T).where(...Object.entries(where).map(([k, v]) => eq(T[k]!, v))))
}

export async function categoryVisible(ctx: Ctx, r: Row): Promise<boolean> {
  const seen = new Set<unknown>()
  let cursor: Row | null = r
  while (cursor) {
    if (!cursor.visible || cursor.archived || seen.has(cursor.id)) return false
    seen.add(cursor.id)
    cursor = cursor.parentId
      ? ((await ctx.db.select('website_catalog.Category', { siteId: r.siteId, id: cursor.parentId }))[0] ??
        null)
      : null
  }
  return true
}
