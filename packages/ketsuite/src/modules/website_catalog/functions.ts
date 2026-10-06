import { randomUUID } from 'node:crypto'
import { cardData, cardDataForLayout, catalogSections, materializeCards } from './cards.ts'
import { asc, defineFn, eq, from, ilike, inArray, isNull, not, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as productFunctions, saveTemplateFunction } from '../product/functions.ts'
import { functions as seoFunctions } from '../website_seo/functions.ts'
import { functions as searchFunctions } from '../website_search/functions.ts'
import { createSaveMenu } from '../website_menu/studio-menu.ts'
import { cmsFunctions } from '../website/cms.ts'
import { studioAppearance } from '../website/studio-style.ts'
import { sections } from '../website/sections.ts'
import { liveDocument } from '../../ui/live-document.ts'
import {
  bindingFields,
  bindingRow,
  bound,
  categoryIds,
  categoryVisible,
  checkLayout,
  deleteRows,
  effective,
  fail,
  ids,
  nodes,
  object,
  parse,
  pathOf,
  publicBinding,
  readEffects,
  replace,
  scoped,
  site,
  slugOf,
  source,
  validateImages,
  writeEffects,
} from './helpers.ts'

const nativeSaveMenu = createSaveMenu({ inTransaction: true })
const nativeSaveTemplate = saveTemplateFunction({ inTransaction: true })
const scopeInput = { siteId: 'id' }
const contentFields = (layout: unknown): Record<string, string> =>
  Object.fromEntries(
    [...nodes(layout ?? []).values()].flatMap((n) =>
      n.type === 'website.rich_text'
        ? [[n.id, n.settings.heading ? 'heading' : 'bodyDoc']]
        : n.type === 'website.gallery'
          ? [[n.id, 'images']]
          : n.type === 'website.image'
            ? [[n.id, 'image']]
            : [],
    ),
  )
const page = (raw: unknown, total: number, size: number) =>
  Math.min(Math.max(1, Math.ceil(total / size)), Math.max(1, Math.floor(Number(raw) || 1)))
const choices = async (ctx: Ctx) => ({
  groups: (await ctx.db.select('product.Category')).map((c) => ({ id: c.id, name: c.name })),
  brands: (await ctx.db.select('product.Brand', { active: true })).map((c) => ({ id: c.id, name: c.name })),
})
async function candidates(ctx: Ctx, args: Row, publicRead = false): Promise<Row> {
  await site(ctx, args.siteId, false, publicRead)
  const B = ctx.table('website_catalog.Binding'),
    T = ctx.table('product.Template'),
    V = ctx.table('product.Product')
  const links = await ctx.db.all(
    from(B).where(eq(B.siteId, args.siteId)).select(B.productId, B.variantId, B.visible, B.id),
  )
  let q = from(T).where(inArray(T.type, ['goods', 'service']))
  if (publicRead || args.source === 'unlinked' || args.status === 'active') q = q.where(eq(T.active, true))
  if (publicRead) q = q.where(inArray(T.id, (await publicIds(ctx)).products))
  if (args.type) q = q.where(eq(T.type, args.type))
  if (args.group) {
    const g = (await ctx.db.select('product.Category')).find(
      (g) => g.id === args.group || g.name === args.group,
    )
    q = q.where(eq(T.categoryId, g?.id ?? args.group))
  }
  if (args.brand) {
    const b = (await ctx.db.select('product.Brand', { active: true })).find(
      (b) => b.id === args.brand || b.name === args.brand,
    )
    q = q.where(eq(T.brandId, b?.id ?? args.brand))
  }
  const live = publicRead ? await publicIds(ctx) : null
  const linked = links
    .filter(
      (b) =>
        (!publicRead || (b.visible && (!b.variantId || live!.variants.includes(String(b.variantId))))) &&
        (!args.status ||
          !['visible', 'hidden'].includes(String(args.status)) ||
          b.visible === (args.status === 'visible')),
    )
    .map((b) => String(b.productId))
  const selected = ids(args.selectedIds)
  if (args.source === 'unlinked') {
    if (linked.length) q = q.where(not(inArray(T.id, linked)))
  } else {
    if (!linked.length)
      return { rows: [], total: 0, page: 1, pages: 1, pageSize: 24, ...(await choices(ctx)) }
    q = q.where(inArray(T.id, linked))
  }
  if (args.mode === 'selected') {
    if (!selected.length)
      return { rows: [], total: 0, page: 1, pages: 1, pageSize: 24, ...(await choices(ctx)) }
    q = q.where(inArray(T.id, selected))
  }
  if (args.search) {
    const search = String(args.search).trim().slice(0, 160),
      sku = await ctx.db.all(
        from(V)
          .where(ilike(V.defaultCode, `%${search}%`))
          .select(V.templateId),
      )
    q = q.where(
      sku.length
        ? or(
            ilike(T.name, `%${search}%`),
            inArray(
              T.id,
              sku.map((v) => String(v.templateId)),
            ),
          )
        : ilike(T.name, `%${search}%`),
    )
  }
  const total = await ctx.db.count(q),
    current = page(args.page, total, 24)
  const records = await ctx.db.all(
    q
      .orderBy(asc(T.name), asc(T.id))
      .limit(24)
      .offset((current - 1) * 24),
  )
  const rows = []
  for (const r of records) {
    const p = await source(ctx, r.id)
    rows.push({
      id: p.id,
      name: p.name,
      type: p.type,
      sku: p.sku,
      category: p.category,
      categoryId: p.categoryId,
      brand: p.brand,
      brandId: p.brandId,
      image: (p.gallery as Row[])[0]?.src ?? '',
      active: p.active,
      visible: links.find((b) => b.productId === p.id)?.visible ?? false,
    })
  }
  const c = await choices(ctx)
  return {
    rows,
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / 24)),
    pageSize: 24,
    groups: c.groups.map((g) => g.name),
    brands: c.brands.map((b) => b.name),
    groupChoices: c.groups,
    brandChoices: c.brands,
  }
}
async function getTemplate(ctx: Ctx, args: Row): Promise<Row> {
  const t = await scoped(ctx, 'website_catalog.Template', args.siteId, args.id)
  return { ...t, layout: parse(t.layout), bindings: parse(t.bindings) }
}
async function builder(ctx: Ctx, args: Row): Promise<Row> {
  const website = await site(ctx, args.siteId)
  if (!['product', 'template'].includes(String(args.mode))) fail('Ngữ cảnh builder không hợp lệ.')
  const b =
    args.mode === 'product'
      ? await scoped(ctx, 'website_catalog.Binding', args.siteId, args.id)
      : (
          await ctx.db.select('website_catalog.Binding', {
            siteId: args.siteId,
            templateId: args.id,
            ...(args.productId ? { productId: args.productId } : {}),
          })
        )[0]
  if (!b) fail('Chọn sản phẩm để xem template.')
  const t = await getTemplate(ctx, { siteId: args.siteId, id: b!.templateId }),
    p = await source(ctx, b!.productId),
    sourceLayout = bound(t, args.mode === 'product' ? { ...p, websiteContent: b!.contentLayout ?? [] } : p)
  return {
    entry: {
      id: args.id,
      type: 'page',
      title: args.mode === 'product' ? effective(p, b!).name : t.title,
      path: b!.path,
      slug: String(b!.path).split('/').at(-1),
      locale: 'vi',
      state: 'live',
      revisionId: `${b!.revisionId}|${t.revisionId}|${p.revisionId}`,
      layout: args.mode === 'product' ? bound(t, effective(p, b!)) : sourceLayout,
      sectionData: await cardDataForLayout(
        ctx,
        args.siteId,
        args.mode === 'product' ? bound(t, effective(p, b!)) : sourceLayout,
      ),
      catalog: {
        mode: args.mode,
        productId: p.id,
        bindingId: b!.id,
        templateId: t.id,
        sourceLayout,
        fields: {
          ...Object.fromEntries((t.bindings as Row[]).map((f) => [f.nodeId, bindingFields[String(f.field)]])),
          ...(args.mode === 'product' ? contentFields(b!.contentLayout) : {}),
        },
      },
    },
    sections: { ...sections, ...catalogSections },
    site: { id: website.id, title: website.title, locale: website.defaultLocale },
    appearance: studioAppearance(ctx, website),
  }
}
async function ensureTemplate(ctx: Ctx, siteId: unknown, type: unknown): Promise<Row> {
  let t = (await ctx.db.select('website_catalog.Template', { siteId, productType: type }))[0]
  if (t) return t
  const layout = [
    {
      id: 'overview',
      type: 'website.columns',
      settings: { gap: 'comfortable' },
      slots: {
        left: [
          { id: 'gallery', type: 'website.gallery', settings: { images: '[]', galleryLayout: 'slider' } },
        ],
        right: [
          { id: 'name', type: 'website.rich_text', settings: { heading: '', body: '' } },
          { id: 'summary', type: 'website.rich_text', settings: { body: '', bodyDoc: '[]' } },
          {
            id: 'cta',
            type: 'website.callout',
            settings: { heading: '', ctaLabel: 'Liên hệ tư vấn', ctaHref: '/lien-he' },
          },
        ],
      },
    },
    { id: 'content', type: 'website.rich_text', settings: { body: '', bodyDoc: '[]' } },
  ]
  t = {
    id: randomUUID(),
    siteId,
    title: type === 'service' ? 'Chi tiết dịch vụ' : 'Chi tiết sản phẩm',
    productType: type,
    revisionId: randomUUID(),
    layout,
    bindings: [
      { nodeId: 'gallery', field: 'product.gallery' },
      { nodeId: 'name', field: 'product.name' },
      { nodeId: 'summary', field: 'product.summaryDoc' },
      { nodeId: 'content', field: 'product.descriptionDoc' },
    ],
  }
  checkLayout(ctx, layout)
  await ctx.db.insertIfAbsent('website_catalog.Template', t)
  return (await ctx.db.select('website_catalog.Template', { siteId, productType: type }))[0]!
}
async function addProduct(ctx: Ctx, args: Row): Promise<Row> {
  await site(ctx, args.siteId, true)
  const p = await source(ctx, args.productId)
  if (!p.active || !['goods', 'service'].includes(String(p.type)))
    fail('Sản phẩm không hoạt động hoặc không hỗ trợ trên website.')
  const existing = (
    await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, productId: args.productId })
  )[0]
  if (existing) return bindingRow(ctx, existing)
  const template = await ensureTemplate(ctx, args.siteId, p.type)
  const b = {
    id: args.id ?? randomUUID(),
    siteId: args.siteId,
    productId: p.id,
    variantId: null,
    templateId: template.id,
    path: pathOf(args.path ?? `/p/${slugOf(p.name)}-${String(p.id).slice(0, 8)}`),
    visible: false,
    position: 0,
    action: 'quote',
    revisionId: randomUUID(),
    overrides: null,
  }
  await ctx.db.insertIfAbsent('website_catalog.Binding', b)
  return bindingRow(
    ctx,
    (await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, productId: p.id }))[0]!,
  )
}
async function categoryRow(ctx: Ctx, r: Row): Promise<Row> {
  const memberships = await ctx.db.select('website_catalog.Membership', {
    siteId: r.siteId,
    categoryId: r.id,
  })
  const selected = memberships
    .filter((m) => !m.excluded)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((m) => m.productId)
  const group = r.ruleGroup ? (await ctx.db.select('product.Category', { id: r.ruleGroup }))[0] : null
  return {
    ...r,
    ruleGroup: group?.name ?? '',
    descriptionDoc:
      typeof r.descriptionDoc === 'string' ? r.descriptionDoc : JSON.stringify(r.descriptionDoc ?? []),
    productIds: selected,
    excludeIds: memberships.filter((m) => m.excluded).map((m) => m.productId),
    count: (await categoryIds(ctx, r)).length,
  }
}
async function publicIds(ctx: Ctx): Promise<{ products: string[]; variants: string[] }> {
  const T = ctx.table('product.Template'),
    V = ctx.table('product.Product')
  const active = await ctx.db.all(from(V).where(eq(V.active, true)).select(V.id, V.templateId)),
    templates = new Set(active.map((v) => v.templateId))
  return {
    products: (await ctx.db.all(from(T).where(eq(T.active, true)).select(T.id)))
      .filter((r) => templates.has(r.id))
      .map((r) => String(r.id)),
    variants: active.map((r) => String(r.id)),
  }
}
async function categoryView(ctx: Ctx, r: Row, publicRead: boolean): Promise<Row> {
  if (!publicRead) return categoryRow(ctx, r)
  return Object.fromEntries(
    [
      'id',
      'title',
      'path',
      'kind',
      'description',
      'descriptionDoc',
      'thumbnail',
      'thumbnailAlt',
      'cover',
      'coverAlt',
      'seoTitle',
      'seoDescription',
      'canonical',
      'indexing',
    ].map((key) => [key, r[key]]),
  )
}
async function categoryProducts(ctx: Ctx, args: Row, publicRead = false): Promise<Row> {
  await site(ctx, args.siteId, false, publicRead)
  const r = args.id
    ? await scoped(ctx, 'website_catalog.Category', args.siteId, args.id)
    : (await ctx.db.select('website_catalog.Category', { siteId: args.siteId, path: args.path }))[0]
  if (!r || r.archived || (publicRead && !(await categoryVisible(ctx, r))))
    return { rows: [], preview: [], total: 0, page: 1, brands: [], category: null }
  const selected = await categoryIds(ctx, r, publicRead),
    B = ctx.table('website_catalog.Binding')
  let q = from(B).where(eq(B.siteId, args.siteId))
  if (!selected.length)
    return {
      rows: [],
      preview: [],
      total: 0,
      page: 1,
      brands: [],
      category: await categoryView(ctx, r, publicRead),
    }
  q = q.where(inArray(B.productId, selected))
  // Match IDs on the source table, before loading images or other card data.
  const T = ctx.table('product.Template')
  let pq = from(T).where(inArray(T.id, selected), eq(T.active, true)).select(T.id)
  if (args.search) pq = pq.where(ilike(T.name, `%${String(args.search).slice(0, 160)}%`))
  if (args.brand) pq = pq.where(eq(T.brandId, args.brand))
  const active = await ctx.db.all(pq)
  if (!active.length)
    return {
      rows: [],
      preview: [],
      total: 0,
      page: 1,
      brands: [],
      category: await categoryView(ctx, r, publicRead),
    }
  q = q.where(
    inArray(
      B.productId,
      active.map((p) => String(p.id)),
    ),
  )
  if (publicRead) {
    const live = await publicIds(ctx)
    q = q.where(
      eq(B.visible, true),
      inArray(B.productId, live.products),
      or(isNull(B.variantId), inArray(B.variantId, live.variants)),
    )
  }
  const matchingBindings = await ctx.db.all(q.select(B.id, B.productId)),
    matchedIds = new Set(matchingBindings.map((b) => b.productId))
  let ordered = selected.filter((id) => matchedIds.has(id))
  if (r.primarySort !== 'manual' && ordered.length) {
    let sorted = from(T).where(inArray(T.id, ordered)).select(T.id)
    sorted = sorted.orderBy(r.primarySort === 'priceAsc' ? asc(T.listPrice) : asc(T.name), asc(T.id))
    ordered = (await ctx.db.all(sorted)).map((p) => String(p.id))
  }
  const total = ordered.length,
    current = page(args.page, total, 12),
    at = ordered.slice((current - 1) * 12, current * 12)
  const records = at.length
      ? (await ctx.db.all(from(B).where(eq(B.siteId, args.siteId), inArray(B.productId, at)))).sort(
          (a, b) => at.indexOf(String(a.productId)) - at.indexOf(String(b.productId)),
        )
      : [],
    rows = []
  for (const b of records) {
    const p = publicRead
      ? await publicBinding(ctx, b)
      : { ...effective(await source(ctx, b.productId), b), visible: b.visible, path: b.path, bindingId: b.id }
    if (p) rows.push(p)
  }
  const children = await ctx.db.select('website_catalog.Category', {
    siteId: args.siteId,
    parentId: r.id,
    visible: true,
    archived: false,
  })
  return {
    category: await categoryView(ctx, r, publicRead),
    rows,
    preview: rows,
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / 12)),
    brands: (await choices(ctx)).brands.map((b) => b.name),
    children: children.map((c) => ({ id: c.id, title: c.title, path: c.path })),
  }
}

export const functions: Record<string, FnSpec> = {
  cardData: defineFn({
    anonymous: true,
    input: { ...scopeInput, settings: 'json' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, false, true)
      return cardData(ctx, args.siteId, object(args.settings))
    },
  }),
  resolveRedirect: defineFn({
    anonymous: true,
    input: { ...scopeInput, path: 'text' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, false, true)
      const r = (await ctx.db.select('website_catalog.Redirect', { siteId: args.siteId, path: args.path }))[0]
      if (!r) return null
      if (r.bindingId) {
        const b = (
          await ctx.db.select('website_catalog.Binding', { id: r.bindingId, siteId: args.siteId })
        )[0]
        return b && b.path !== args.path && (await publicBinding(ctx, b)) ? { path: b.path } : null
      }
      const c = r.categoryId
        ? (await ctx.db.select('website_catalog.Category', { id: r.categoryId, siteId: args.siteId }))[0]
        : null
      return c && c.path !== args.path && (await categoryVisible(ctx, c)) ? { path: c.path } : null
    },
  }),
  saveMenu: defineFn({
    exposure: 'internal',
    input: { ...scopeInput, expectedRevisionId: 'text?', title: 'text?', items: 'json' },
    effects: [...new Set([...writeEffects, ...nativeSaveMenu.effects!])],
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        if (!Array.isArray(args.items)) fail('Menu không hợp lệ.')
        const items = structuredClone(args.items) as Row[]
        for (const item of items)
          if (item.catalogCategoryId) {
            const c = await scoped(tx, 'website_catalog.Category', args.siteId, item.catalogCategoryId)
            if (c.archived) fail('Danh mục đã lưu trữ.')
            item.href = c.path
          }
        const result = (await nativeSaveMenu.handler(tx, { ...args, items })) as Row
        if (result.ok === false) fail(JSON.stringify(result.errors))
        for (const item of items)
          if (item.catalogCategoryId)
            await tx.db.update(
              'website_menu.MenuItem',
              { id: item.id, siteId: args.siteId },
              { catalogCategoryId: item.catalogCategoryId },
            )
        return result
      }),
  }),
  sitemapEntries: defineFn({
    exposure: 'internal',
    input: scopeInput,
    effects: [...new Set([...readEffects, ...seoFunctions.sitemapEntries!.effects!])],
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, false, true)
      const cms = (await seoFunctions.sitemapEntries!.handler(ctx, args)) as Row[],
        allBindings = await ctx.db.select('website_catalog.Binding', { siteId: args.siteId }),
        paths = new Set(allBindings.map((b) => b.path)),
        result = cms.filter((r) => !paths.has(r.path))
      const live = await publicIds(ctx),
        productIds = new Set(live.products),
        variantIds = new Set(live.variants)
      for (const b of allBindings)
        if (
          b.visible &&
          productIds.has(String(b.productId)) &&
          (!b.variantId || variantIds.has(String(b.variantId)))
        )
          result.push({ path: b.path, lastModified: b.updatedAt })
      for (const c of await ctx.db.select('website_catalog.Category', {
        siteId: args.siteId,
        archived: false,
      }))
        if (c.indexing !== 'noindex' && (await categoryVisible(ctx, c)))
          result.push({ path: c.path, lastModified: c.updatedAt })
      return [...new Map(result.map((r) => [r.path, r])).values()]
    },
  }),
  searchIndexed: defineFn({
    anonymous: true,
    input: { ...scopeInput, q: 'text', type: 'text?', limit: 'int?', offset: 'int?' },
    effects: [...new Set([...readEffects, ...searchFunctions.searchIndexed!.effects!])],
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, false, true)
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20)),
        offset = Math.max(0, Number(args.offset) || 0),
        term = String(args.q).trim().slice(0, 100)
      if (term.length < 2) return { hits: [], total: 0, stale: false }
      const T = ctx.table('product.Template'),
        B = ctx.table('website_catalog.Binding')
      const matching = await ctx.db.all(
        from(T)
          .where(eq(T.active, true), or(ilike(T.name, `%${term}%`), ilike(T.description, `%${term}%`)))
          .select(T.id),
      )
      const live = await publicIds(ctx)
      let q = from(B).where(
        eq(B.siteId, args.siteId),
        eq(B.visible, true),
        inArray(B.productId, live.products),
        or(isNull(B.variantId), inArray(B.variantId, live.variants)),
      )
      q = q.where(
        matching.length
          ? or(
              inArray(
                B.productId,
                matching.map((p) => String(p.id)),
              ),
              ilike(B.searchText, `%${term}%`),
            )
          : ilike(B.searchText, `%${term}%`),
      )
      const count = args.type && args.type !== 'website.product' ? 0 : await ctx.db.count(q),
        records = count ? await ctx.db.all(q.orderBy(asc(B.path)).limit(limit).offset(offset)) : [],
        hits = []
      for (const b of records) {
        const p = await publicBinding(ctx, b)
        if (p)
          hits.push({
            id: b.id,
            type: 'website.product',
            path: b.path,
            title: p.name,
            excerpt: p.description,
          })
      }
      const cms = (await searchFunctions.searchIndexed!.handler(ctx, {
        ...args,
        limit: Math.max(1, limit - hits.length),
        offset: Math.max(0, offset - count),
      })) as Row
      return {
        hits: [
          ...hits,
          ...(hits.length >= limit || (offset < count && offset + limit <= count) ? [] : (cms.hits as Row[])),
        ],
        total: count + Number(cms.total ?? 0),
        stale: cms.stale,
      }
    },
  }),
  tagMedia: defineFn({
    exposure: 'internal',
    input: { siteId: 'id', id: 'id', productId: 'id', role: 'text' },
    effects: [...writeEffects, 'write:product_media.Media', 'write:product.Template'],
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        if (!['overview', 'content'].includes(String(args.role))) fail('Vai trò ảnh không hợp lệ.')
        const m = (await tx.db.select('product_media.Media', { id: args.id, templateId: args.productId }))[0]
        if (!m) fail('Ảnh không thuộc sản phẩm.')
        if (m!.role !== args.role) {
          await tx.db.update('product_media.Media', { id: m!.id }, { role: args.role })
          await tx.db.update('product.Template', { id: args.productId }, { revisionId: randomUUID() })
        }
        return { ok: true }
      }),
  }),
  importTemplate: defineFn({
    exposure: 'internal',
    input: { ...scopeInput, id: 'id', expectedRevisionId: 'text', layout: 'json', bindings: 'json' },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const t = await getTemplate(tx, args)
        checkLayout(tx, args.layout)
        if (!Array.isArray(args.bindings)) fail('Liên kết template không hợp lệ.')
        const p = { name: '', type: t.productType, gallery: [], summaryDoc: '[]', descriptionDoc: '[]' }
        bound({ ...t, layout: args.layout, bindings: args.bindings }, p)
        await replace(tx, 'website_catalog.Template', t, args.expectedRevisionId, {
          layout: args.layout,
          bindings: args.bindings,
        })
        return getTemplate(tx, args)
      }),
  }),
  importProductContent: defineFn({
    exposure: 'internal',
    input: { ...scopeInput, id: 'id', expectedRevisionId: 'text', contentLayout: 'json' },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const b = await scoped(tx, 'website_catalog.Binding', args.siteId, args.id)
        const layout = structuredClone(args.contentLayout)
        checkLayout(tx, layout)
        for (const n of nodes(layout).values()) {
          if (n.type === 'website.gallery' && n.settings.images)
            await validateImages(tx, args.siteId, 'website_catalog.Binding', b.id, parse(n.settings.images))
          if (n.type === 'website.image' && n.settings.image)
            await validateImages(tx, args.siteId, 'website_catalog.Binding', b.id, [
              { src: n!.settings.image, alt: n!.settings.alt },
            ])
        }
        await replace(tx, 'website_catalog.Binding', b, args.expectedRevisionId, { contentLayout: layout })
        return bindingRow(tx, await scoped(tx, 'website_catalog.Binding', args.siteId, args.id))
      }),
  }),
  importCategoryPresentation: defineFn({
    exposure: 'internal',
    input: { ...scopeInput, id: 'id', expectedRevisionId: 'text', path: 'text', layout: 'json' },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const c = await scoped(tx, 'website_catalog.Category', args.siteId, args.id)
        const layout = structuredClone(args.layout)
        checkLayout(tx, layout)
        await replace(tx, 'website_catalog.Category', c, args.expectedRevisionId, {
          layout,
          path: pathOf(args.path),
        })
        return categoryRow(tx, await scoped(tx, 'website_catalog.Category', args.siteId, args.id))
      }),
  }),
  createProduct: defineFn({
    exposure: 'internal',
    idempotent: true,
    input: { ...scopeInput, id: 'id', name: 'text', type: 'text', categoryId: 'id?', description: 'text?' },
    effects: [...new Set([...writeEffects, ...productFunctions.saveTemplate!.effects!])],
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const existing = (await tx.db.select('product.Template', { id: args.id }))[0]
        if (!existing) {
          const result = (await nativeSaveTemplate.handler(tx, args)) as Row
          if (!result.ok) fail(JSON.stringify(result.errors))
        } else if (existing.name !== args.name || existing.type !== args.type)
          fail('Conflict: ID sản phẩm đã được dùng.', 'conflict')
        return addProduct(tx, { siteId: args.siteId, productId: args.id })
      }),
  }),
  getSource: defineFn({
    exposure: 'internal',
    input: { id: 'id', siteId: 'id' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId)
      const p = await source(ctx, args.id)
      const links = await ctx.db.select('website_catalog.Binding', { productId: p.id })
      const sites = await ctx.db.select('website.Site')
      return {
        ...p,
        categoryChoices: (await choices(ctx)).groups,
        affectedSites: links.map((b) => ({
          id: b.siteId,
          name: sites.find((s) => s.id === b.siteId)?.title ?? '',
          bindingId: b.id,
          visible: b.visible,
        })),
      }
    },
  }),
  productCandidates: defineFn({
    input: {
      ...scopeInput,
      search: 'text?',
      group: 'text?',
      brand: 'text?',
      type: 'text?',
      status: 'text?',
      mode: 'text?',
      selectedIds: 'json?',
      page: 'int?',
      source: 'text?',
    },
    effects: readEffects,
    handler: candidates,
  }),
  listBindings: defineFn({
    input: { ...scopeInput, search: 'text?', status: 'text?', page: 'int?' },
    effects: readEffects,
    handler: async (ctx, args) => {
      const data = await candidates(ctx, args),
        rows = []
      for (const p of data.rows as Row[])
        rows.push(
          await bindingRow(
            ctx,
            (await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, productId: p.id }))[0]!,
          ),
        )
      return {
        ...data,
        rows,
        visible: await ctx.db.count(
          from(ctx.table('website_catalog.Binding')).where(
            eq(ctx.table('website_catalog.Binding').siteId, args.siteId),
            eq(ctx.table('website_catalog.Binding').visible, true),
          ),
        ),
        templates: await ctx.db.select('website_catalog.Template', { siteId: args.siteId }),
        candidates: [],
      }
    },
  }),
  getBinding: defineFn({
    input: { ...scopeInput, id: 'id' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId)
      return bindingRow(ctx, await scoped(ctx, 'website_catalog.Binding', args.siteId, args.id))
    },
  }),
  addProduct: defineFn({
    input: { ...scopeInput, productId: 'id', id: 'id?', path: 'text?' },
    effects: writeEffects,
    idempotent: true,
    handler: async (ctx, args) => ctx.tx((tx) => addProduct(tx, args)),
  }),
  saveBinding: defineFn({
    input: {
      ...scopeInput,
      id: 'id',
      expectedRevisionId: 'text',
      visible: 'bool',
      path: 'text',
      templateId: 'id',
      action: 'text',
      seoTitle: 'text?',
      seoDescription: 'text?',
      categoryIds: 'json?',
      primaryCategoryId: 'text?',
    },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const b = await scoped(tx, 'website_catalog.Binding', args.siteId, args.id),
          t = await getTemplate(tx, { siteId: args.siteId, id: args.templateId }),
          p = await source(tx, b.productId)
        if (t.productType !== p.type || args.action !== 'quote') fail('Template hoặc hành động không hợp lệ.')
        const categoryList = ids(args.categoryIds),
          primary = String(args.primaryCategoryId ?? '')
        if (primary && !categoryList.includes(primary))
          fail('Danh mục chính phải nằm trong danh mục đã chọn.')
        for (const id of categoryList) {
          const c = await scoped(tx, 'website_catalog.Category', args.siteId, id)
          if (c.kind !== 'category' || c.archived) fail('Danh mục không hợp lệ.')
        }
        if (args.visible) {
          const media = await tx.db.select('product_media.Media', { templateId: b.productId })
          for (const m of media) {
            const a = (await tx.db.select('storage.Attachment', { id: m.attachmentId }))[0]
            if (
              a?.kind === 'stored' &&
              a.storeKey &&
              a.resModel === 'product.Template' &&
              a.resId === b.productId &&
              /^image\/(png|jpeg|webp|avif)$/.test(String(a.mimetype))
            )
              await tx.db.update('storage.Attachment', { id: a.id }, { public: true })
          }
        }
        const path = pathOf(args.path),
          collision = (await tx.db.select('website_catalog.Binding', { siteId: args.siteId, path })).find(
            (x) => x.id !== b.id,
          )
        if (
          (await tx.db.select('website_catalog.Redirect', { siteId: args.siteId, path })).some(
            (r) => r.bindingId !== b.id,
          )
        )
          fail('Đường dẫn được giữ cho chuyển hướng.')
        if (
          collision ||
          (await tx.db.select('website_catalog.Category', { siteId: args.siteId, path })).length
        )
          fail('Đường dẫn đã sử dụng.')
        await replace(tx, 'website_catalog.Binding', b, args.expectedRevisionId, {
          path,
          visible: args.visible,
          templateId: t.id,
          action: args.action,
          seoTitle: args.seoTitle ?? '',
          seoDescription: args.seoDescription ?? '',
          primaryCategoryId: primary || null,
        })
        if (path !== b.path)
          await tx.db.insertIfAbsent('website_catalog.Redirect', {
            id: randomUUID(),
            siteId: args.siteId,
            path: b.path,
            targetPath: path,
            bindingId: b.id,
          })
        const old = await tx.db.select('website_catalog.Membership', {
            siteId: args.siteId,
            productId: b.productId,
          }),
          all = await tx.db.select('website_catalog.Category', { siteId: args.siteId, kind: 'category' })
        for (const m of old)
          if (all.some((c) => c.id === m.categoryId) && !categoryList.includes(String(m.categoryId)))
            await deleteRows(tx, 'website_catalog.Membership', { id: m.id })
        for (const id of categoryList)
          await tx.db.insertIfAbsent('website_catalog.Membership', {
            id: randomUUID(),
            siteId: args.siteId,
            categoryId: id,
            productId: b.productId,
            excluded: false,
            position: 0,
          })
        for (const c of all.filter(
          (c) => categoryList.includes(String(c.id)) || old.some((m) => m.categoryId === c.id),
        ))
          await replace(tx, 'website_catalog.Category', c, c.revisionId, {})
        return bindingRow(tx, await scoped(tx, 'website_catalog.Binding', args.siteId, b.id))
      }),
  }),
  removeBinding: defineFn({
    input: { ...scopeInput, id: 'id', expectedRevisionId: 'text', confirmed: 'bool' },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        if (!args.confirmed) fail('Xác nhận gỡ liên kết.')
        const b = await scoped(tx, 'website_catalog.Binding', args.siteId, args.id)
        await replace(tx, 'website_catalog.Binding', b, args.expectedRevisionId, { visible: false })
        await deleteRows(tx, 'website_catalog.Membership', { siteId: args.siteId, productId: b.productId })
        await deleteRows(tx, 'website_catalog.Redirect', { bindingId: b.id })
        await deleteRows(tx, 'website_catalog.Binding', { id: b.id })
        return { ok: true }
      }),
  }),
  getTemplate: defineFn({
    input: { ...scopeInput, id: 'id' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId)
      const template = await getTemplate(ctx, args)
      const B = ctx.table('website_catalog.Binding'),
        records = await ctx.db.all(
          from(B).where(eq(B.siteId, args.siteId), eq(B.templateId, args.id)).limit(24),
        )
      return { template, products: await Promise.all(records.map((b) => bindingRow(ctx, b))) }
    },
  }),
  getBuilder: defineFn({
    input: { ...scopeInput, id: 'id', mode: 'text', productId: 'id?' },
    effects: readEffects,
    handler: builder,
  }),
  saveBuilder: defineFn({
    input: {
      ...scopeInput,
      id: 'id',
      mode: 'text',
      productId: 'id?',
      expectedRevisionId: 'text',
      layout: 'json',
      fields: 'json?',
      title: 'text?',
      excerpt: 'text?',
      path: 'text?',
      slug: 'text?',
      type: 'text?',
    },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        const doc = await builder(tx, args),
          entry = object(doc.entry),
          catalog = object(entry.catalog)
        if (entry.revisionId !== args.expectedRevisionId)
          fail('Conflict: Nguồn hoặc template đã đổi. Tải lại trước khi lưu.', 'conflict')
        const edited = structuredClone(args.layout)
        checkLayout(tx, edited)
        const t = await getTemplate(tx, { siteId: args.siteId, id: catalog.templateId }),
          map = nodes(edited),
          old = nodes(t.layout)
        if (args.mode === 'template') {
          for (const f of t.bindings as Row[]) {
            const n = map.get(String(f.nodeId)),
              original = old.get(String(f.nodeId)),
              key = bindingFields[String(f.field)]
            if (!n || n.type !== original?.type || !key)
              fail('Giữ các block liên kết product trong template.')
            n!.settings = {
              ...n!.settings,
              [key!]: original!.settings?.[key!],
              ...(key === 'bodyDoc' ? { body: original!.settings?.body ?? '' } : {}),
            }
          }
          bound({ ...t, layout: edited }, await source(tx, catalog.productId))
          await replace(tx, 'website_catalog.Template', t, t.revisionId, { layout: edited })
        } else {
          const b = await scoped(tx, 'website_catalog.Binding', args.siteId, args.id),
            base = nodes(catalog.sourceLayout),
            compare = structuredClone(edited),
            compareNodes = nodes(compare),
            overrides: Row = {}
          for (const f of t.bindings as Row[]) {
            const n = map.get(String(f.nodeId)),
              sourceNode = base.get(String(f.nodeId)),
              key = bindingFields[String(f.field)]
            if (!n || n.type !== sourceNode?.type || !key) fail('Sửa bố cục ở template dùng chung.')
            const value = n!.settings?.[key!],
              sourceValue = sourceNode!.settings?.[key!]
            if (JSON.stringify(value) !== JSON.stringify(sourceValue)) {
              const property = String(f.field).slice(8)
              if (property === 'name') {
                if (typeof value !== 'string' || !value.trim()) fail('Nhập tên hiển thị.')
                overrides.name = value
              } else if (property === 'gallery') {
                const gallery = parse(value)
                await validateImages(tx, args.siteId, 'website_catalog.Binding', b.id, gallery)
                overrides.gallery = gallery
              } else overrides[property] = liveDocument(value, { images: false }).doc
            }
            const c = compareNodes.get(String(f.nodeId))!
            c.settings = { ...c.settings, [key!]: sourceValue }
            if (key === 'bodyDoc') c.settings.body = sourceNode!.settings?.body ?? ''
          }
          const originalContent = Array.isArray(b.contentLayout) ? (b.contentLayout as Row[]) : []
          const contentNodeIds = new Set([...nodes(originalContent).keys()])
          const content = (edited as Row[]).filter((n) => contentNodeIds.has(String(n.id)))
          for (const [nodeId, key] of Object.entries(contentFields(originalContent))) {
            const n = map.get(nodeId),
              original = base.get(nodeId),
              normalized = compareNodes.get(nodeId)
            if (!n || !original || !normalized || n.type !== original.type)
              fail('Giữ cấu trúc nội dung riêng.')
            if (key === 'images')
              await validateImages(tx, args.siteId, 'website_catalog.Binding', b.id, parse(n!.settings[key]))
            if (key === 'image' && n!.settings.image)
              await validateImages(tx, args.siteId, 'website_catalog.Binding', b.id, [
                { src: n!.settings.image, alt: n!.settings.alt ?? '' },
              ])
            normalized!.settings[key] = original!.settings[key]
            if (key === 'bodyDoc') normalized!.settings.body = original!.settings.body
          }
          if (JSON.stringify(content) !== JSON.stringify(originalContent)) overrides.contentLayout = content
          if (JSON.stringify(compare) !== JSON.stringify(catalog.sourceLayout))
            fail('Chỉ sửa nội dung riêng. Sửa bố cục ở template dùng chung.')
          await replace(tx, 'website_catalog.Binding', b, b.revisionId, {
            overrides,
            searchText: [overrides.name, overrides.summaryDoc].filter(Boolean).join(' '),
          })
        }
        return { ok: true, ...(await builder(tx, args)) }
      }),
  }),
  listCategories: defineFn({
    input: { ...scopeInput, kind: 'text?' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId)
      const records = await ctx.db.select('website_catalog.Category', {
        siteId: args.siteId,
        archived: false,
        ...(args.kind ? { kind: args.kind } : {}),
      })
      return { rows: await Promise.all(records.map((r) => categoryRow(ctx, r))), total: records.length }
    },
  }),
  getCategory: defineFn({
    input: { ...scopeInput, id: 'id', kind: 'text?' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId)
      const r =
        args.id === 'new'
          ? {
              id: 'new',
              siteId: args.siteId,
              kind: args.kind === 'collection' ? 'collection' : 'category',
              title: '',
              slug: '',
              parentId: null,
              position: 0,
              visible: false,
              archived: false,
              includeChildren: false,
              mode: 'manual',
              ruleGroup: '',
              ruleType: '',
              primarySort: 'manual',
              description: '',
              descriptionDoc: '[]',
              cover: '',
              coverAlt: '',
              thumbnail: '',
              thumbnailAlt: '',
              seoTitle: '',
              seoDescription: '',
              canonical: '',
              indexing: 'index',
              revisionId: null,
              path: '',
              productIds: [],
              excludeIds: [],
            }
          : await categoryRow(ctx, await scoped(ctx, 'website_catalog.Category', args.siteId, args.id))
      const preview = args.id === 'new' ? [] : (await categoryProducts(ctx, args)).rows
      const parents = await ctx.db.select('website_catalog.Category', {
          siteId: args.siteId,
          kind: 'category',
          archived: false,
        }),
        total = await ctx.db.count(
          from(ctx.table('website_catalog.Binding')).where(
            eq(ctx.table('website_catalog.Binding').siteId, args.siteId),
          ),
        )
      return {
        category: r,
        parents: parents.filter((p) => p.id !== r.id),
        sourceGroups: (await choices(ctx)).groups.map((g) => g.name),
        groupChoices: (await choices(ctx)).groups,
        hasServices:
          (await ctx.db.count(
            from(ctx.table('product.Template')).where(eq(ctx.table('product.Template').type, 'service')),
          )) > 0,
        productTotal: total,
        preview,
      }
    },
  }),
  saveCategory: defineFn({
    input: {
      ...scopeInput,
      id: 'id',
      expectedRevisionId: 'text?',
      kind: 'text',
      title: 'text',
      slug: 'text',
      parentId: 'id?',
      position: 'int',
      visible: 'bool',
      includeChildren: 'bool',
      mode: 'text',
      productIds: 'json',
      excludeIds: 'json?',
      ruleGroup: 'text?',
      ruleType: 'text?',
      primarySort: 'text',
      description: 'text?',
      descriptionDoc: 'text?',
      thumbnail: 'text?',
      thumbnailAlt: 'text?',
      cover: 'text?',
      coverAlt: 'text?',
      seoTitle: 'text?',
      seoDescription: 'text?',
      canonical: 'text?',
      indexing: 'text',
    },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        if (args.ruleType && !['goods', 'service'].includes(String(args.ruleType)))
          fail('Loại sản phẩm không hợp lệ.')
        if (!['manual', 'name', 'priceAsc'].includes(String(args.primarySort))) fail('Sắp xếp không hợp lệ.')
        if (
          !['category', 'collection'].includes(String(args.kind)) ||
          !String(args.title).trim() ||
          !['manual', 'rules'].includes(String(args.mode)) ||
          !['index', 'noindex'].includes(String(args.indexing))
        )
          fail('Thông tin danh mục không hợp lệ.')
        const selected = ids(args.productIds),
          excluded = ids(args.excludeIds)
        if (selected.some((id) => excluded.includes(id))) fail('Sản phẩm vừa được chọn vừa bị loại trừ.')
        const old = (await tx.db.select('website_catalog.Category', { siteId: args.siteId, id: args.id }))[0]
        if (old?.archived || (old && old.kind !== args.kind)) fail('Danh mục không hợp lệ.')
        const all = await tx.db.select('website_catalog.Category', { siteId: args.siteId, archived: false }),
          parentId = args.kind === 'category' ? args.parentId || null : null
        let cursor = parentId ? all.find((c) => c.id === parentId && c.kind === 'category') : null
        if (parentId && !cursor) fail('Danh mục cha không hợp lệ.')
        const seen = new Set([args.id])
        while (cursor) {
          if (seen.has(cursor.id)) fail('Danh mục không được tạo vòng lặp.')
          seen.add(cursor.id)
          cursor = all.find((c) => c.id === cursor!.parentId) ?? null
        }
        const slug = String(args.slug).trim()
        if (!/^[\p{L}\p{N}_~-]+$/u.test(slug)) fail('Slug không hợp lệ.')
        const prefix = old?.path
          ? String(old.path).split('/').slice(1, -1).join('/')
          : args.kind === 'collection'
            ? 'bo-suu-tap'
            : 'danh-muc'
        const path = pathOf(`/${prefix}/${slug}`)
        if (
          (await tx.db.select('website_catalog.Redirect', { siteId: args.siteId, path })).some(
            (r) => r.categoryId !== args.id,
          )
        )
          fail('Đường dẫn được giữ cho chuyển hướng.')
        if (
          all.some((c) => c.path === path && c.id !== args.id) ||
          (await tx.db.select('website_catalog.Binding', { siteId: args.siteId, path })).length
        )
          fail('Đường dẫn đã sử dụng.')
        if (args.canonical && !/^https:\/\/[^\s]+$/.test(String(args.canonical)))
          fail('Canonical phải là URL HTTPS.')
        for (const id of [...selected, ...excluded])
          if (!(await tx.db.select('website_catalog.Binding', { siteId: args.siteId, productId: id }))[0])
            fail('Sản phẩm chưa được liên kết với website.')
        for (const field of ['thumbnail', 'cover'])
          if (args[field])
            await validateImages(tx, args.siteId, 'website_catalog.Category', args.id, [
              { src: args[field], alt: args[`${field}Alt`] ?? '' },
            ])
        const description = args.descriptionDoc ? liveDocument(args.descriptionDoc, { images: false }) : null
        const { expectedRevisionId, productIds, excludeIds, ...values } = args
        const patch = {
          ...values,
          parentId,
          path,
          description: description?.text ?? args.description ?? '',
          descriptionDoc: description?.doc ?? '[]',
          ruleGroup: args.ruleGroup
            ? ((await tx.db.select('product.Category')).find(
                (g) => g.id === args.ruleGroup || g.name === args.ruleGroup,
              )?.id ?? fail('Nhóm sản phẩm không hợp lệ.'))
            : '',
          ruleType: args.ruleType ?? '',
        }
        if (old) await replace(tx, 'website_catalog.Category', old, expectedRevisionId, patch)
        else {
          if (expectedRevisionId) fail('Conflict: Danh mục chưa tồn tại.', 'conflict')
          await tx.db.insert('website_catalog.Category', {
            ...patch,
            archived: false,
            revisionId: randomUUID(),
          })
        }
        const previousMembers = await tx.db.select('website_catalog.Membership', {
          siteId: args.siteId,
          categoryId: args.id,
        })
        await deleteRows(tx, 'website_catalog.Membership', { siteId: args.siteId, categoryId: args.id })
        for (const [position, productId] of [...selected, ...excluded].entries())
          await tx.db.insert('website_catalog.Membership', {
            id: randomUUID(),
            siteId: args.siteId,
            categoryId: args.id,
            productId,
            position,
            excluded: excluded.includes(productId),
          })
        const affected = new Set([
          ...selected,
          ...excluded,
          ...previousMembers.map((m) => String(m.productId)),
        ])
        for (const productId of affected) {
          const binding = (
            await tx.db.select('website_catalog.Binding', { siteId: args.siteId, productId })
          )[0]
          if (binding)
            await replace(tx, 'website_catalog.Binding', binding, binding.revisionId, {
              ...(binding.primaryCategoryId === args.id && !selected.includes(productId)
                ? { primaryCategoryId: null }
                : {}),
            })
        }
        if (old && old.path !== path)
          await tx.db.insertIfAbsent('website_catalog.Redirect', {
            id: randomUUID(),
            siteId: args.siteId,
            path: old.path,
            targetPath: path,
            categoryId: old.id,
          })
        const menuItems = await tx.db.select('website_menu.MenuItem', {
          siteId: args.siteId,
          catalogCategoryId: args.id,
        })
        for (const item of menuItems)
          await tx.db.update('website_menu.MenuItem', { id: item.id }, { href: path })
        if (menuItems.length)
          await tx.db.update('website_menu.Menu', { siteId: args.siteId }, { revision: randomUUID() })
        return categoryRow(tx, await scoped(tx, 'website_catalog.Category', args.siteId, args.id))
      }),
  }),
  archiveCategory: defineFn({
    input: { ...scopeInput, id: 'id', expectedRevisionId: 'text', confirmed: 'bool' },
    effects: writeEffects,
    handler: async (ctx, args) =>
      ctx.tx(async (tx) => {
        await site(tx, args.siteId, true)
        if (!args.confirmed) fail('Xác nhận lưu trữ danh mục.')
        const r = await scoped(tx, 'website_catalog.Category', args.siteId, args.id)
        if (
          (
            await tx.db.select('website_catalog.Category', {
              siteId: args.siteId,
              parentId: r.id,
              archived: false,
            })
          ).length
        )
          fail('Danh mục vẫn có danh mục con.')
        if (
          (await tx.db.select('website_menu.MenuItem', { siteId: args.siteId, catalogCategoryId: r.id }))
            .length
        )
          fail('Danh mục vẫn được dùng trong menu.')
        await replace(tx, 'website_catalog.Category', r, args.expectedRevisionId, {
          archived: true,
          visible: false,
        })
        return { ok: true }
      }),
  }),
  previewCategory: defineFn({
    input: { ...scopeInput, id: 'id', search: 'text?', brand: 'text?', page: 'int?' },
    effects: readEffects,
    handler: categoryProducts,
  }),
  categoryProducts: defineFn({
    anonymous: true,
    input: { ...scopeInput, id: 'id?', path: 'text?', search: 'text?', brand: 'text?', page: 'int?' },
    effects: readEffects,
    handler: (ctx, args) => categoryProducts(ctx, args, true),
  }),
  publicProduct: defineFn({
    anonymous: true,
    input: { ...scopeInput, path: 'text' },
    effects: readEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, false, true)
      const b = (await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, path: args.path }))[0]
      return b ? publicBinding(ctx, b) : null
    },
  }),
  publicList: defineFn({
    anonymous: true,
    input: { ...scopeInput, category: 'id?', page: 'int?' },
    effects: readEffects,
    handler: async (ctx, args) => {
      if (args.category) return categoryProducts(ctx, { ...args, id: args.category }, true)
      const data = await candidates(ctx, args, true),
        rows = []
      for (const r of data.rows as Row[]) {
        const b = (
          await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, productId: r.id })
        )[0]
        const p = b ? await publicBinding(ctx, b) : null
        if (p) rows.push(p)
      }
      return { rows, total: data.total, page: data.page, pages: data.pages }
    },
  }),
  getEntryByPath: defineFn({
    anonymous: true,
    input: { ...scopeInput, path: 'text', page: 'int?' },
    effects: [...new Set([...readEffects, ...cmsFunctions.getEntryByPath!.effects!])],
    handler: async (ctx, args) => {
      if (args.siteId === '__legacy__') return cmsFunctions.getEntryByPath!.handler(ctx, args)
      const s = await site(ctx, args.siteId, false, true),
        path = String(args.path).replace(/\/$/, '') || '/'
      const b = (await ctx.db.select('website_catalog.Binding', { siteId: args.siteId, path }))[0]
      if (b) {
        const p = await publicBinding(ctx, b)
        if (!p) return null
        const t = await getTemplate(ctx, { siteId: args.siteId, id: b.templateId })
        return {
          id: b.id,
          siteId: s.id,
          type: 'website.product',
          path: b.path,
          title: p.name,
          excerpt: p.description,
          layout: await materializeCards(
            ctx,
            args.siteId,
            bound(t, p).filter(
              (n) =>
                !(
                  n.type === 'website.rich_text' &&
                  !n.settings.heading &&
                  !n.settings.body &&
                  (!n.settings.bodyDoc || n.settings.bodyDoc === '[]')
                ),
            ),
          ),
          fields: {
            productId: p.id,
            seo: { title: b.seoTitle || p.name, description: b.seoDescription || p.description },
          },
          meta: { title: b.seoTitle || p.name, metaDescription: b.seoDescription || p.description },
          published: true,
          appearance: object(s.studioStyle),
        }
      }
      const c = (await ctx.db.select('website_catalog.Category', { siteId: args.siteId, path }))[0]
      if (c) {
        const result = await categoryProducts(ctx, { ...args, id: c.id }, true)
        if (!result.category) return null
        const rows = result.rows as Row[]
        return {
          id: c.id,
          siteId: s.id,
          type: 'website.page',
          path,
          title: c.title,
          layout: categoryLayout(c, rows, Number(result.page), Number(result.pages)),
          fields: {
            seo: {
              title: c.seoTitle || c.title,
              description: c.seoDescription || c.description,
              canonical: c.canonical,
              indexing: c.indexing,
            },
          },
          meta: {
            title: c.seoTitle || c.title,
            metaDescription: c.seoDescription || c.description,
            canonical: c.canonical,
            noindex: c.indexing === 'noindex',
          },
          published: true,
          appearance: object(s.studioStyle),
        }
      }
      const cms = (await cmsFunctions.getEntryByPath!.handler(ctx, args)) as Row | null
      return cms ? { ...cms, layout: await materializeCards(ctx, args.siteId, cms.layout) } : null
    },
  }),
}

function categoryLayout(c: Row, products: Row[], current: number, pages: number): Row[] {
  const layout = c.layout
    ? (structuredClone(parse(c.layout)) as Row[])
    : [
        {
          id: 'category-heading',
          type: 'website.rich_text',
          settings: { heading: c.title, body: c.description ?? '', bodyDoc: c.descriptionDoc ?? '[]' },
        },
      ]
  const hasCards = (n: Row): boolean =>
    [...nodes([n]).values()].some((child) => String(child.settings.ctaHref ?? '').startsWith('/p/'))
  const card = (p: Row): Row[] => [
    {
      id: `catalog-image-${p.id}`,
      type: 'website.image',
      settings: { image: (p.gallery as Row[])[0]?.src ?? '', alt: p.name, imageFit: 'contain' },
    },
    {
      id: `catalog-link-${p.id}`,
      type: 'website.callout',
      settings: { heading: p.name, body: p.description, ctaLabel: 'Xem chi tiết', ctaHref: p.path },
    },
  ]
  const pair = (a: Row | undefined, b: Row | undefined, id: string): Row => ({
    id,
    type: 'website.columns',
    settings: { gap: 'comfortable' },
    slots: { left: a ? card(a) : [], right: b ? card(b) : [] },
  })
  const grid = []
  for (let i = 0; i < products.length; i += 4)
    grid.push({
      id: `catalog-row-${i}`,
      type: 'website.columns',
      settings: { gap: 'comfortable' },
      slots: {
        left: [pair(products[i], products[i + 1], `catalog-pair-${i}`)],
        right: products[i + 2] ? [pair(products[i + 2], products[i + 3], `catalog-pair-${i + 2}`)] : [],
      },
    })
  const result = []
  let inserted = false
  for (const n of layout) {
    if (hasCards(n)) {
      if (!inserted) {
        result.push(...grid)
        inserted = true
      }
    } else result.push(n)
  }
  if (!inserted) result.push(...grid)
  if (pages > 1)
    result.push({
      id: 'catalog-pager',
      type: 'website.columns',
      settings: { gap: 'compact' },
      slots: {
        left:
          current > 1
            ? [
                {
                  id: 'catalog-previous',
                  type: 'website.callout',
                  settings: {
                    heading: '',
                    ctaLabel: 'Trang trước',
                    ctaHref: `${c.path}?page=${current - 1}`,
                  },
                },
              ]
            : [],
        right:
          current < pages
            ? [
                {
                  id: 'catalog-next',
                  type: 'website.callout',
                  settings: { heading: '', ctaLabel: 'Trang sau', ctaHref: `${c.path}?page=${current + 1}` },
                },
              ]
            : [],
      },
    })
  return result
}
