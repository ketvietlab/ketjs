import {
  asc,
  bucketEq,
  compileListFilter,
  defineFn,
  deleteFrom,
  desc,
  eq,
  from,
  ilike,
  inArray,
  isNull,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, ListState, Row } from '@ketvietlab/ketjs'
import { PRODUCT_TYPES } from './types.ts'
import { emptyProductListState, productListSearch } from './search.ts'

/**
 * The same escape the framework applies to `state.q`, so a term containing `%`
 * or `_` is matched literally rather than as a wildcard. Paired with the escape
 * flag on `ilike`, which is what puts `ESCAPE '\'` on the statement.
 */
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

/**
 * The `search` and `limit` a relation picker sends, applied in memory.
 *
 * These lists are small and already fully loaded by their handler, so narrowing
 * here costs nothing and keeps the picker's contract — a `search` term and a
 * `limit` on every call — satisfiable without a second query path.
 */
const narrow = (
  rows: Row[],
  args: { search?: unknown; limit?: unknown; offset?: unknown },
  fields: string[],
): Row[] => {
  const needle = String(args.search ?? '')
    .trim()
    .toLocaleLowerCase()
  const matched = needle
    ? rows.filter((row) =>
        fields.some((field) =>
          String(row[field] ?? '')
            .toLocaleLowerCase()
            .includes(needle),
        ),
      )
    : rows
  const rawOffset = Number(args.offset)
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  const limit = Number(args.limit)
  return Number.isInteger(limit) && limit > 0 ? matched.slice(offset, offset + limit) : matched.slice(offset)
}

/**
 * A caller's list state is JSON, so it may be partial or the wrong shape entirely.
 * Filling every field from the empty state keeps `compileListFilter` and the group
 * walk working on the arrays they are typed to expect: `{ state: {} }` is a
 * reasonable thing for an agent to send, and it should narrow nothing rather than
 * throw a TypeError from inside the framework.
 */
const listStateOf = (value: unknown): ListState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ListState>
  const empty = emptyProductListState()
  const page = Number(raw.page)
  return {
    ...empty,
    ...raw,
    presets: Array.isArray(raw.presets) ? raw.presets : empty.presets,
    filters: Array.isArray(raw.filters) ? raw.filters : empty.filters,
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy : empty.groupBy,
    sort: Array.isArray(raw.sort) && raw.sort.length ? raw.sort : empty.sort,
    openGroups: Array.isArray(raw.openGroups) ? raw.openGroups : empty.openGroups,
    groupPages: raw.groupPages && typeof raw.groupPages === 'object' ? raw.groupPages : empty.groupPages,
    page: Number.isInteger(page) && page > 0 ? page : empty.page,
    includeArchived: raw.includeArchived === true,
  }
}

const templateQuery = (
  ctx: Ctx,
  args: {
    type?: string | null
    search?: string | null
    state?: unknown
    path?: unknown
    timezone?: string | null
  },
) => {
  const T = ctx.table('product.Template')
  const state = listStateOf(args.state)
  const normalized = state ?? emptyProductListState()
  let query = from(T)
  if (!normalized.includeArchived) query = query.where(eq(T.active, true))
  if (args.type != null) query = query.where(eq(T.type, args.type))
  if (args.search) query = query.where(ilike(T.name, `%${wildcard(args.search)}%`, true))
  const compiled = compileListFilter(productListSearch(T), normalized, { timezone: args.timezone ?? 'UTC' })
  if (compiled) query = query.where(compiled)
  const path = Array.isArray(args.path) ? args.path : []
  const spec = productListSearch(T)
  for (let index = 0; index < path.length; index++) {
    const selected = normalized.groupBy[index]
    const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
    if (!field) continue
    const value = path[index]
    query = query.where(
      value == null
        ? isNull(field.col)
        : selected?.interval
          ? bucketEq(field.col, selected.interval, args.timezone ?? 'UTC', String(value))
          : eq(field.col, value),
    )
  }
  const sorts = normalized.sort.length ? normalized.sort : [{ key: 'name', dir: 'asc' as const }]
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))
  for (const sort of sorts) {
    const col = sortable.get(sort.key)
    if (col) query = query.orderBy(sort.dir === 'desc' ? desc(col) : asc(col))
  }
  return query
}

const productExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  Boolean((await ctx.db.select('product.Product', { id }))[0])

/**
 * The id of a company-scoped row, carrying the company it belongs to.
 *
 * `id` is a tenant-wide primary key, so a derived id built only from the shared
 * ids either collides across companies or reads as another company's row. Reads
 * span the whole readable company set while writes are pinned to the active
 * company, so a lookup that ignores the company finds a row it can never write.
 */
const companyKey = (company: string, ...parts: unknown[]): string =>
  [company, ...parts.map((part) => String(part))].join(':')

const uomRoot = (row: Row): string => String(row.parentPath).split('/').filter(Boolean)[0] ?? ''

/**
 * What a variant is called, spelled out from the values that define it.
 *
 * `product.Product` has no name of its own — a variant *is* its combination, and
 * storing a copy of that would be a second source of truth to keep in step. So
 * the name is derived: "Đỏ · L" for a variant of colour and size. Callers that
 * only need one variant still pay one pass, which is why the whole set is
 * resolved at once rather than per row.
 */
const describeVariants = async (ctx: Ctx, products: Row[]): Promise<Row[]> => {
  if (!products.length) return products
  const wanted = new Set(products.map((product) => String(product.id)))
  const links = (await ctx.db.select('product.ProductValue')).filter((link) =>
    wanted.has(String(link.productId)),
  )
  if (!links.length) return products.map((product) => ({ ...product, values: [], name: null }))
  const templateValues = new Map(
    (await ctx.db.select('product.TemplateAttributeValue')).map((row) => [String(row.id), row]),
  )
  const attributeValues = new Map(
    (await ctx.db.select('product.AttributeValue')).map((row) => [String(row.id), row]),
  )
  const lines = new Map(
    (await ctx.db.select('product.TemplateAttributeLine')).map((row) => [String(row.id), row]),
  )
  const attributes = new Map((await ctx.db.select('product.Attribute')).map((row) => [String(row.id), row]))
  const byProduct = new Map<string, Row[]>()
  for (const link of links) {
    const templateValue = templateValues.get(String(link.templateAttributeValueId))
    const value = templateValue ? attributeValues.get(String(templateValue.valueId)) : undefined
    if (!value) continue
    const line = templateValue ? lines.get(String(templateValue.lineId)) : undefined
    const attribute = line ? attributes.get(String(line.attributeId)) : undefined
    const held = byProduct.get(String(link.productId)) ?? []
    held.push({
      valueId: String(value.id),
      value: String(value.name),
      attributeId: attribute ? String(attribute.id) : null,
      attribute: attribute ? String(attribute.name) : null,
      sequence: Number(attribute?.sequence ?? 10),
      valueSequence: Number(value.sequence ?? 10),
    })
    byProduct.set(String(link.productId), held)
  }
  return products.map((product) => {
    const values = (byProduct.get(String(product.id)) ?? []).sort(
      (a, b) =>
        Number(a.sequence) - Number(b.sequence) ||
        Number(a.valueSequence) - Number(b.valueSequence) ||
        String(a.value).localeCompare(String(b.value)),
    )
    return {
      ...product,
      values,
      name: values.length ? values.map((entry) => String(entry.value)).join(' · ') : null,
    }
  })
}

const templateSummary = (template: Row) => ({
  id: String(template.id),
  name: String(template.name),
  type: String(template.type),
  categoryId: template.categoryId == null ? null : String(template.categoryId),
  uomId: template.uomId == null ? null : String(template.uomId),
  saleOk: template.saleOk === true,
  purchaseOk: template.purchaseOk === true,
  active: template.active !== false,
})

type FieldErrors = { ok: false; errors: Array<{ field: string; message: string }> }
type UomTarget = { ok: true; company: string; id: string; existing: Row | undefined }

/**
 * What both unit writers have to agree on before touching `product.ProductUom`.
 *
 * The existing row is matched on (productId, uomId) within the active company
 * rather than on a derived id: a read spans every readable company, so an id-only
 * lookup can return a sibling company's row — which the write then filters out,
 * changing nothing. Matching this way also still finds rows written under the
 * older tenant-global id scheme.
 */
const productUomTarget = async (
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<FieldErrors | UomTarget> => {
  if (!(await productExists(ctx, args.productId)))
    return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
  const company = ctx.scope.company
  if (!company)
    return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi đơn vị' }] }
  const unit = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
  if (!unit) return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị không tồn tại' }] }
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]!
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
  const primary = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : null
  if (!primary || uomRoot(primary) !== uomRoot(unit))
    return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị phải cùng cây với UoM mặc định' }] }
  const existing = (
    await ctx.db.select('product.ProductUom', { productId: args.productId, uomId: args.uomId })
  ).find((row) => String(row.companyId) === company)
  return {
    ok: true,
    company,
    id: existing ? String(existing.id) : companyKey(company, args.productId, args.uomId),
    existing,
  }
}

/**
 * Whether a barcode is held by a row that will still exist after this write.
 *
 * The index is `(companyId, barcode)`, so the check is scoped to the company —
 * and `ignoreIds` names the rows the caller is about to overwrite or delete.
 * Without it, replacing a variant's unit while keeping its barcode collides with
 * the very row the replacement removes.
 */
const productUomBarcodeTaken = async (
  ctx: Ctx,
  company: string,
  barcode: unknown,
  ignoreIds: Set<string>,
): Promise<boolean> =>
  (await ctx.db.select('product.ProductUom', { barcode })).some(
    (row) => String(row.companyId) === company && !ignoreIds.has(String(row.id)),
  )

/** The ids this company holds for a variant — every row a replace will drop. */
const productUomIds = async (ctx: Ctx, company: string, productId: unknown): Promise<Set<string>> =>
  new Set(
    (await ctx.db.select('product.ProductUom', { productId }))
      .filter((row) => String(row.companyId) === company)
      .map((row) => String(row.id)),
  )

const writeProductUom = async (ctx: Ctx, target: UomTarget, args: Record<string, unknown>): Promise<void> => {
  if (target.existing)
    await ctx.db.update('product.ProductUom', { id: target.id }, { barcode: args.barcode ?? null })
  else
    await ctx.db.insert('product.ProductUom', {
      id: target.id,
      productId: args.productId,
      uomId: args.uomId,
      barcode: args.barcode ?? null,
    })
  await ctx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
}

/** Drop every unit this company holds for the variant, except the one being kept. */
const dropProductUoms = async (
  ctx: Ctx,
  company: string,
  productId: unknown,
  keep: string | null,
): Promise<void> => {
  const U = ctx.table('product.ProductUom')
  for (const row of await ctx.db.select('product.ProductUom', { productId }))
    if (String(row.companyId) === company && String(row.id) !== keep)
      await ctx.db.del(deleteFrom(U).where(eq(U.id, row.id)))
}

export const functions: Record<string, FnSpec> = {
  /**
   * The variants of one template, or of the whole catalogue.
   *
   * `templateId` became optional so a relation picker on a sale or purchase line
   * can search every variant at once — that field holds a variant, not a template,
   * and the forms were flat-mapping the entire catalogue into a `<select>`.
   * `search` matches the derived name, the internal reference and the barcode,
   * which are the three things a person has in front of them.
   */
  listVariants: defineFn({
    input: {
      templateId: 'id?',
      ids: 'json?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
      includeArchived: 'bool?',
      active: 'bool?',
      type: 'text?',
      saleOk: 'bool?',
      purchaseOk: 'bool?',
      requireUom: 'bool?',
    },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const wanted = Array.isArray(args.ids) ? [...new Set(args.ids.map(String))].slice(0, 2_000) : null
      if (wanted && !wanted.length) return []
      const P = ctx.table('product.Product')
      const rows = wanted
        ? await ctx.db.all(from(P).where(inArray(P.id, wanted)))
        : await ctx.db.select(
            'product.Product',
            args.templateId == null ? {} : { templateId: args.templateId },
          )
      const templates = new Map((await ctx.db.select('product.Template')).map((row) => [String(row.id), row]))
      const eligible = rows.filter((row) => {
        const template = templates.get(String(row.templateId))
        if (!template) return false
        const active = row.active !== false && template.active !== false
        if (args.includeArchived !== true && !active) return false
        if (args.active === true && !active) return false
        if (args.active === false && active) return false
        if (args.type && template.type !== args.type) return false
        if (args.saleOk === true && template.saleOk !== true) return false
        if (args.purchaseOk === true && template.purchaseOk !== true) return false
        if (args.requireUom === true && template.uomId == null) return false
        return true
      })
      const described = await describeVariants(ctx, eligible)
      // The template's name is what makes a variant recognisable in a list that
      // spans the catalogue: "Xanh nghiệp vụ" alone says nothing about which
      // product it belongs to.
      const labelled: Row[] = described.map((variant) => ({
        ...variant,
        templateName:
          templates.get(String(variant.templateId))?.name == null
            ? null
            : String(templates.get(String(variant.templateId))!.name),
        template: templateSummary(templates.get(String(variant.templateId))!),
      }))
      return narrow(
        labelled.sort((left, right) => String(left.id).localeCompare(String(right.id))),
        args,
        ['name', 'templateName', 'defaultCode', 'barcode'],
      )
    },
  }),

  /** Safe catalogue detail without company cost or barcode-unit records. */
  getVariantSummary: defineFn({
    input: { id: 'id' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const found = (await ctx.db.select('product.Product', { id: args.id }))[0]
      if (!found) return null
      const template = (await ctx.db.select('product.Template', { id: found.templateId }))[0]
      if (!template) return null
      const product = (await describeVariants(ctx, [found]))[0]!
      return { ...product, template: templateSummary(template) }
    },
  }),

  getVariant: defineFn({
    input: { id: 'id' },
    effects: [
      'read:product.Product',
      'read:product.Cost',
      'read:product.ProductUom',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const found = (await ctx.db.select('product.Product', { id: args.id }))[0]
      if (!found) return null
      const product = (await describeVariants(ctx, [found]))[0]!
      // Cost and ProductUom are company-scoped, and a read spans every readable
      // company — so both are narrowed to the active one. Otherwise the variant
      // screen shows a sibling company's cost and unit, and saving the form
      // writes those values into this company.
      const company = ctx.scope.company
      const costs = await ctx.db.select('product.Cost', { productId: args.id })
      const uoms = await ctx.db.select('product.ProductUom', { productId: args.id })
      const mine = (rows: Row[]): Row[] =>
        company ? rows.filter((row) => String(row.companyId) === company) : []
      return {
        ...product,
        cost: mine(costs)[0] ?? null,
        // Ordered, because the variant form renders `uoms[0]` and `select` has no
        // ORDER BY of its own.
        uoms: mine(uoms).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      }
    },
  }),

  listAttributes: defineFn({
    input: { search: 'text?', limit: 'int?' },
    effects: ['read:product.Attribute', 'read:product.AttributeValue'],
    agent: true,
    handler: async (ctx, args) => {
      const A = ctx.table('product.Attribute')
      const rows = await ctx.db.all(from(A).orderBy(asc(A.sequence), asc(A.name)).preload('values'))
      return narrow(rows, args, ['name'])
    },
  }),

  /**
   * Attribute values on their own, rather than nested inside their attribute.
   *
   * A picker asks for the values of one attribute and narrows them as the user
   * types; reaching them through `listAttributes` would mean shipping every
   * attribute's values to filter one attribute's worth in the browser.
   */
  listAttributeValues: defineFn({
    input: { attributeId: 'id?', search: 'text?', limit: 'int?' },
    output: { id: 'id', attributeId: 'id', name: 'text', sequence: 'int' },
    effects: ['read:product.AttributeValue'],
    agent: true,
    handler: async (ctx, args) => {
      const V = ctx.table('product.AttributeValue')
      const base = from(V).orderBy(asc(V.sequence), asc(V.name))
      const rows = await ctx.db.all(
        args.attributeId == null ? base : base.where(eq(V.attributeId, args.attributeId)),
      )
      return narrow(rows, args, ['name'])
    },
  }),

  listTemplates: defineFn({
    input: {
      withVariants: 'bool?',
      type: 'text?',
      search: 'text?',
      state: 'json?',
      path: 'json?',
      timezone: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    output: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      uomId: 'id?',
      description: 'text?',
      listPrice: 'decimal',
      saleOk: 'bool',
      purchaseOk: 'bool',
      active: 'bool?',
      createdAt: 'datetime?',
      updatedAt: 'datetime?',
      variants: 'json?',
    },
    effects: ['read:product.Template', 'read:product.Product', 'read:product.TemplateUom'],
    agent: true,
    handler: async (ctx, args) => {
      let query = templateQuery(ctx, args)
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
      const rows = await ctx.db.all(args.withVariants === true ? query.preload('variants') : query)
      return rows
    },
  }),

  countTemplates: defineFn({
    input: { type: 'text?', search: 'text?', state: 'json?', timezone: 'text?' },
    output: { count: 'int' },
    effects: ['read:product.Template'],
    agent: true,
    handler: async (ctx, args) => ({ count: await ctx.db.count(templateQuery(ctx, args)) }),
  }),

  groupTemplates: defineFn({
    input: { state: 'json', path: 'json?', timezone: 'text?', limit: 'int?', offset: 'int?' },
    effects: ['read:product.Template'],
    agent: true,
    handler: async (ctx, args) => {
      const state = listStateOf(args.state)
      if (!state) return []
      const path = Array.isArray(args.path) ? args.path : []
      const T = ctx.table('product.Template')
      const spec = productListSearch(T)
      let query = templateQuery(ctx, { state, path, timezone: String(args.timezone ?? 'UTC') })
      const selected = state.groupBy[path.length]
      const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
      if (!field) return []
      query = query
        .groupBy({ col: field.col, interval: selected?.interval, timezone: String(args.timezone ?? 'UTC') })
        .orderGroupsBy({ by: 'key', dir: 'asc' })
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
      return ctx.db.group(query)
    },
  }),

  getTemplate: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      uomId: 'id?',
      description: 'text?',
      listPrice: 'decimal',
      saleOk: 'bool',
      purchaseOk: 'bool',
      active: 'bool?',
      variants: 'json?',
      category: 'json?',
      uoms: 'json?',
      attributeLines: 'json?',
    },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:product.Category',
      'read:product.TemplateUom',
      'read:product.TemplateAttributeLine',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('product.Template')
      const row = await ctx.db.one(
        from(T).where(eq(T.id, args.id)).preload('variants', 'category', 'uoms', 'attributeLines'),
      )
      return row
    },
  }),

  saveTemplate: defineFn({
    input: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      uomId: 'id?',
      description: 'text?',
      listPrice: 'decimal?',
      saleOk: 'bool?',
      purchaseOk: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template', 'read:uom.Unit', 'write:uom.Unit'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!PRODUCT_TYPES.includes(args.type as never))
        return {
          ok: false,
          errors: [{ field: 'type', message: `phải là một trong: ${PRODUCT_TYPES.join(', ')}` }],
        }
      if (args.uomId && !(await ctx.db.select('uom.Unit', { id: args.uomId }))[0])
        return { ok: false, errors: [{ field: 'uomId', message: 'không có đơn vị nào mang id này' }] }
      const existing = (await ctx.db.select('product.Template', { id: args.id }))[0]
      let changes = ctx
        .change('product.Template', args, existing ?? null)
        .cast([
          'id',
          'name',
          'type',
          'categoryId',
          'uomId',
          'description',
          'listPrice',
          'saleOk',
          'purchaseOk',
        ])
        .required(['name', 'type'])
      if (!existing) {
        changes = changes
          .put('listPrice', args.listPrice ?? '0')
          .put('saleOk', args.saleOk ?? true)
          .put('purchaseOk', args.purchaseOk ?? true)
          .put('active', true)
      }
      if (!changes.valid) return { ok: false, errors: changes.errors }
      await ctx.tx(async (tx) => {
        await tx.db.commit(changes, existing ? { id: args.id } : undefined)
        if (args.uomId) await tx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
      })
      return { ok: true, id: args.id }
    },
  }),

  saveVariant: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      defaultCode: 'text?',
      sku: 'text?',
      barcode: 'text?',
      weight: 'decimal?',
      volume: 'decimal?',
      combinationKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'read:product.Template', 'write:product.Product'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return { ok: false, errors: [{ field: 'templateId', message: 'không có template nào mang id này' }] }
      const existing = (await ctx.db.select('product.Product', { id: args.id }))[0]
      if (args.barcode) {
        const collision = (await ctx.db.select('product.Product', { barcode: args.barcode }))[0]
        if (collision && collision.id !== args.id)
          return { ok: false, errors: [{ field: 'barcode', message: 'barcode đã được dùng' }] }
      }
      const values = {
        ...args,
        defaultCode: args.defaultCode ?? args.sku ?? null,
        combinationKey: args.combinationKey ?? `manual:${args.id}`,
      }
      // combinationKey is the variant's identity, so it is only ever set on the way
      // in — never rewritten by an edit that did not name it. Casting it every time
      // meant setting a barcode on a generated variant replaced its attribute
      // combination with "manual:<id>" and silently unhooked it from its values.
      const fields = ['id', 'templateId', 'defaultCode', 'barcode', 'weight', 'volume']
      if (!existing || args.combinationKey != null) fields.push('combinationKey')
      let changes = ctx
        .change('product.Product', values, existing ?? null)
        .cast(fields)
        .required(['templateId'])
      if (!existing)
        changes = changes
          .put('weight', args.weight ?? '0')
          .put('volume', args.volume ?? '0')
          .put('active', true)
      if (!changes.valid) return { ok: false, errors: changes.errors }
      await ctx.db.commit(changes, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  saveAttribute: defineFn({
    input: {
      id: 'id',
      name: 'text',
      sequence: 'int?',
      displayType: 'text?',
      createVariant: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Attribute', 'write:product.Attribute'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const createVariant = String(args.createVariant ?? 'always')
      if (createVariant === 'dynamic')
        return { ok: false, errors: [{ field: 'createVariant', message: 'dynamic cần module Sale' }] }
      if (!['always', 'no_variant'].includes(createVariant))
        return { ok: false, errors: [{ field: 'createVariant', message: 'phải là always hoặc no_variant' }] }
      const displayType = String(args.displayType ?? 'select')
      if (!['radio', 'pills', 'select', 'color', 'multi'].includes(displayType))
        return { ok: false, errors: [{ field: 'displayType', message: 'displayType không được hỗ trợ' }] }
      const existing = (await ctx.db.select('product.Attribute', { id: args.id }))[0]
      const values = {
        ...args,
        sequence: args.sequence ?? 10,
        displayType,
        createVariant,
        active: args.active ?? true,
      }
      const cs = ctx
        .change('product.Attribute', values, existing ?? null)
        .cast(['id', 'name', 'sequence', 'displayType', 'createVariant', 'active'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  saveAttributeValue: defineFn({
    input: { id: 'id', attributeId: 'id', name: 'text', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Attribute', 'read:product.AttributeValue', 'write:product.AttributeValue'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Attribute', { id: args.attributeId }))[0])
        return {
          ok: false,
          errors: [{ field: 'attributeId', message: 'không có thuộc tính nào mang id này' }],
        }
      const existing = (await ctx.db.select('product.AttributeValue', { id: args.id }))[0]
      const values = { ...args, sequence: args.sequence ?? 10 }
      const cs = ctx
        .change('product.AttributeValue', values, existing ?? null)
        .cast(['id', 'attributeId', 'name', 'sequence'])
        .required(['name', 'attributeId'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  /**
   * The attribute lines of a template, each with the values it allows.
   *
   * `getTemplate` preloads the lines but not what is on them, and a line without
   * its values says nothing a reader can act on — "Màu sắc" is not an answer to
   * "which colours does this product come in".
   */
  listAttributeLines: defineFn({
    input: { templateId: 'id' },
    output: { id: 'id', templateId: 'id', attributeId: 'id', attribute: 'text?', values: 'json?' },
    effects: [
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const lines = await ctx.db.select('product.TemplateAttributeLine', { templateId: args.templateId })
      if (!lines.length) return []
      const attributes = new Map(
        (await ctx.db.select('product.Attribute')).map((row) => [String(row.id), row]),
      )
      const values = new Map(
        (await ctx.db.select('product.AttributeValue')).map((row) => [String(row.id), row]),
      )
      const templateValues = await ctx.db.select('product.TemplateAttributeValue')
      const byLine = new Map<string, Row[]>()
      for (const templateValue of templateValues) {
        const value = values.get(String(templateValue.valueId))
        if (!value) continue
        const held = byLine.get(String(templateValue.lineId)) ?? []
        held.push({ id: String(value.id), name: String(value.name), sequence: Number(value.sequence ?? 10) })
        byLine.set(String(templateValue.lineId), held)
      }
      return lines
        .map((line) => {
          const attribute = attributes.get(String(line.attributeId))
          return {
            id: String(line.id),
            templateId: String(line.templateId),
            attributeId: String(line.attributeId),
            attribute: attribute ? String(attribute.name) : null,
            sequence: Number(attribute?.sequence ?? 10),
            values: (byLine.get(String(line.id)) ?? []).sort(
              (a, b) =>
                Number(a.sequence) - Number(b.sequence) || String(a.name).localeCompare(String(b.name)),
            ),
          }
        })
        .sort(
          (a, b) =>
            a.sequence - b.sequence || String(a.attribute ?? '').localeCompare(String(b.attribute ?? '')),
        )
    },
  }),

  /**
   * Take an attribute off a template, with the values it carried.
   *
   * Variants already generated from it are left alone: they are real records
   * that may be on documents. Regenerating is what prunes them, and that is a
   * decision the reader makes rather than a side effect of this one.
   */
  removeAttributeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?' },
    effects: [
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ctx.db.select('product.TemplateAttributeLine', { id: args.id }))[0]
      if (!line) return { ok: true }
      await ctx.tx(async (tx) => {
        const TAV = tx.table('product.TemplateAttributeValue')
        for (const value of await tx.db.select('product.TemplateAttributeValue', { lineId: args.id }))
          await tx.db.del(deleteFrom(TAV).where(eq(TAV.id, value.id)))
        const TAL = tx.table('product.TemplateAttributeLine')
        await tx.db.del(deleteFrom(TAL).where(eq(TAL.id, args.id)))
      })
      return { ok: true, id: String(args.id) }
    },
  }),

  saveAttributeLine: defineFn({
    input: { id: 'id', templateId: 'id', attributeId: 'id', valueIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const valueIds = Array.isArray(args.valueIds) ? args.valueIds.map(String) : []
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
      if (!(await ctx.db.select('product.Attribute', { id: args.attributeId }))[0])
        return { ok: false, errors: [{ field: 'attributeId', message: 'thuộc tính không tồn tại' }] }
      for (const valueId of valueIds) {
        const value = (await ctx.db.select('product.AttributeValue', { id: valueId }))[0]
        if (!value || value.attributeId !== args.attributeId)
          return {
            ok: false,
            errors: [{ field: 'valueIds', message: `${valueId} không thuộc thuộc tính đã chọn` }],
          }
      }
      await ctx.tx(async (tx) => {
        await tx.db.insertIfAbsent('product.TemplateAttributeLine', {
          id: args.id,
          templateId: args.templateId,
          attributeId: args.attributeId,
        })
        for (const valueId of valueIds)
          await tx.db.insertIfAbsent('product.TemplateAttributeValue', {
            id: `${args.id}:${valueId}`,
            lineId: args.id,
            valueId,
          })
        const wanted = new Set(valueIds.map((valueId) => `${String(args.id)}:${valueId}`))
        const current = await tx.db.select('product.TemplateAttributeValue', { lineId: args.id })
        const TAV = tx.table('product.TemplateAttributeValue')
        for (const value of current)
          if (!wanted.has(String(value.id))) await tx.db.del(deleteFrom(TAV).where(eq(TAV.id, value.id)))
      })
      return { ok: true, id: args.id }
    },
  }),

  generateVariants: defineFn({
    input: { templateId: 'id' },
    output: { ok: 'bool', created: 'int?', ids: 'json?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.Attribute',
      'read:product.Product',
      'write:product.Product',
      'write:product.ProductValue',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
      const lines = await ctx.db.select('product.TemplateAttributeLine', { templateId: args.templateId })
      const attributes = new Map(
        (await ctx.db.select('product.Attribute')).map((attribute) => [String(attribute.id), attribute]),
      )
      lines.sort((a, b) => {
        const aa = attributes.get(String(a.attributeId))
        const bb = attributes.get(String(b.attributeId))
        return (
          Number(aa?.sequence ?? 10) - Number(bb?.sequence ?? 10) || String(a.id).localeCompare(String(b.id))
        )
      })
      const groups: string[][] = []
      for (const line of lines) {
        const attribute = attributes.get(String(line.attributeId))
        if (!attribute || attribute.createVariant === 'no_variant') continue
        const values = await ctx.db.select('product.TemplateAttributeValue', { lineId: line.id })
        if (values.length)
          groups.push(
            values
              .sort((a, b) => String(a.valueId).localeCompare(String(b.valueId)))
              .map((value) => `${String(value.valueId)}\0${String(value.id)}`),
          )
      }
      const combinations = groups.length
        ? groups.reduce<string[][]>(
            (all, group) => all.flatMap((prefix) => group.map((id) => [...prefix, id])),
            [[]],
          )
        : [[]]
      const ids: string[] = []
      let created = 0
      await ctx.tx(async (tx) => {
        const validKeys = new Set(
          combinations.map((values) => values.map((value) => value.split('\0')[0]).join(',')),
        )
        for (const product of await tx.db.select('product.Product', { templateId: args.templateId }))
          if (
            String(product.id).startsWith(`${String(args.templateId)}:`) &&
            !validKeys.has(String(product.combinationKey))
          )
            await tx.db.update('product.Product', { id: product.id }, { active: false })
        for (const values of combinations) {
          const combinationKey = values.map((value) => value.split('\0')[0]).join(',')
          const id = `${String(args.templateId)}:${combinationKey || 'default'}`
          const result = await tx.db.insertIfAbsent('product.Product', {
            id,
            templateId: args.templateId,
            defaultCode: null,
            barcode: null,
            weight: '0',
            volume: '0',
            combinationKey,
            active: true,
          })
          if ('inserted' in result && result.inserted) created++
          const product = (
            await tx.db.select('product.Product', {
              templateId: args.templateId,
              combinationKey,
            })
          )[0]!
          await tx.db.update('product.Product', { id: product.id }, { active: true })
          ids.push(String(product.id))
          for (const encoded of values) {
            const templateAttributeValueId = encoded.split('\0')[1]!
            await tx.db.insertIfAbsent('product.ProductValue', {
              id: `${String(product.id)}:${templateAttributeValueId}`,
              productId: product.id,
              templateAttributeValueId,
            })
          }
        }
      })
      return { ok: true, created, ids }
    },
  }),

  setCost: defineFn({
    input: { productId: 'id', standardPrice: 'decimal?', amount: 'decimal?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'read:product.Cost', 'write:product.Cost'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await productExists(ctx, args.productId)))
        return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
      if (!ctx.scope.company)
        return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi giá vốn' }] }
      const standardPrice = args.standardPrice ?? args.amount
      if (standardPrice == null)
        return { ok: false, errors: [{ field: 'standardPrice', message: 'bắt buộc' }] }
      // Look the row up by the id that already names the active company, not by
      // productId: a read spans every readable company, so searching on productId
      // alone can return a sibling company's cost. Updating that row then filters
      // on the active company and changes nothing, while the insert branch is
      // skipped — a write that reports success and stores no price.
      const id = companyKey(ctx.scope.company, args.productId)
      const existing = (await ctx.db.select('product.Cost', { id }))[0]
      if (existing) await ctx.db.update('product.Cost', { id }, { standardPrice })
      else await ctx.db.insert('product.Cost', { id, productId: args.productId, standardPrice })
      return { ok: true, id }
    },
  }),

  addTemplateUom: defineFn({
    input: { templateId: 'id', uomId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'read:uom.Unit', 'write:uom.Unit', 'write:product.TemplateUom'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template)
        return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
      const primary = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : null
      const unit = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
      if (!primary || !unit || uomRoot(primary) !== uomRoot(unit))
        return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị phải cùng cây với UoM mặc định' }] }
      const id = `${String(args.templateId)}:${String(args.uomId)}`
      await ctx.db.insertIfAbsent('product.TemplateUom', {
        id,
        templateId: args.templateId,
        uomId: args.uomId,
      })
      await ctx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
      return { ok: true, id }
    },
  }),

  addProductUom: defineFn({
    input: { productId: 'id', uomId: 'id', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
      'write:uom.Unit',
      'write:product.ProductUom',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const target = await productUomTarget(ctx, args)
      if (!target.ok) return target
      // Only this row is overwritten; another unit of the same variant keeping
      // the barcode is a genuine collision.
      if (
        args.barcode &&
        (await productUomBarcodeTaken(ctx, target.company, args.barcode, new Set([target.id])))
      )
        return { ok: false, errors: [{ field: 'barcode', message: 'barcode đã được dùng trong company' }] }
      await writeProductUom(ctx, target, args)
      return { ok: true, id: target.id }
    },
  }),

  /**
   * The variant's unit, as one value rather than a growing list.
   *
   * `addProductUom` is an add and stays one, but the variant form offers a single
   * select: submitting it has to *replace* what is there, or changing the unit
   * silently leaves the old row behind and the form — which renders the first row
   * it is given — keeps showing the unit the user just changed away from. A null
   * `uomId` clears the unit, which is what the form's empty option means.
   */
  setProductUom: defineFn({
    input: { productId: 'id', uomId: 'id?', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
      'write:uom.Unit',
      'write:product.ProductUom',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await productExists(ctx, args.productId)))
        return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
      const company = ctx.scope.company
      if (!company)
        return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi đơn vị' }] }
      if (args.uomId == null) {
        await ctx.tx((tx) => dropProductUoms(tx, company, args.productId, null))
        return { ok: true }
      }
      const target = await productUomTarget(ctx, args)
      if (!target.ok) return target
      // Every unit this variant currently holds is about to be dropped, so none
      // of them can collide — including the one whose barcode is being carried
      // over to the unit replacing it.
      const replaced = await productUomIds(ctx, company, args.productId)
      replaced.add(target.id)
      if (args.barcode && (await productUomBarcodeTaken(ctx, company, args.barcode, replaced)))
        return { ok: false, errors: [{ field: 'barcode', message: 'barcode đã được dùng trong company' }] }
      await ctx.tx(async (tx) => {
        await dropProductUoms(tx, company, args.productId, target.id)
        await writeProductUom(tx, target, args)
      })
      return { ok: true, id: target.id }
    },
  }),

  archiveTemplate: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:product.Template'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      await ctx.db.update('product.Template', { id: args.id }, { active: args.active } as Row)
      return { id: args.id, active: args.active }
    },
  }),

  deleteTemplates: defineFn({
    input: { ids: 'json' },
    output: { deleted: 'int' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:product.Cost',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.ProductValue',
      'write:product.Template',
      'write:product.Product',
      'write:product.Cost',
      'write:product.TemplateUom',
      'write:product.ProductUom',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
      'write:product.ProductValue',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const ids = [...new Set(Array.isArray(args.ids) ? args.ids.map(String).filter(Boolean) : [])]
      if (!ids.length) return { deleted: 0 }
      return ctx.tx(async (tx) => {
        const Template = tx.table('product.Template')
        const Product = tx.table('product.Product')
        const Cost = tx.table('product.Cost')
        const TemplateUom = tx.table('product.TemplateUom')
        const ProductUom = tx.table('product.ProductUom')
        const Line = tx.table('product.TemplateAttributeLine')
        const Value = tx.table('product.TemplateAttributeValue')
        const ProductValue = tx.table('product.ProductValue')
        const products = await tx.db.all(from(Product).where(inArray(Product.templateId, ids)))
        const productIds = products.map((row) => String(row.id))
        const lines = await tx.db.all(from(Line).where(inArray(Line.templateId, ids)))
        const lineIds = lines.map((row) => String(row.id))

        if (productIds.length) {
          await tx.db.del(deleteFrom(ProductValue).where(inArray(ProductValue.productId, productIds)))
          await tx.db.del(deleteFrom(ProductUom).where(inArray(ProductUom.productId, productIds)))
          await tx.db.del(deleteFrom(Cost).where(inArray(Cost.productId, productIds)))
        }
        if (lineIds.length) await tx.db.del(deleteFrom(Value).where(inArray(Value.lineId, lineIds)))
        await tx.db.del(deleteFrom(Line).where(inArray(Line.templateId, ids)))
        await tx.db.del(deleteFrom(TemplateUom).where(inArray(TemplateUom.templateId, ids)))
        if (productIds.length) await tx.db.del(deleteFrom(Product).where(inArray(Product.id, productIds)))
        const result = await tx.db.del(deleteFrom(Template).where(inArray(Template.id, ids)))
        return { deleted: result.changes }
      })
    },
  }),

  listCategories: defineFn({
    // `ids` narrows the answer to the categories a caller already named — a page
    // of products wants the labels behind its categoryIds, not the tenant's whole
    // tree. The rows are still all read, because `path` is an ancestry walk that
    // the selected rows cannot answer alone, but children are left unloaded and
    // only the named categories come back.
    input: { search: 'text?', ids: 'json?', limit: 'int?' },
    output: { id: 'id', name: 'text', parentId: 'id?', path: 'text?', children: 'json?' },
    effects: ['read:product.Category'],
    agent: true,
    handler: async (ctx, args) => {
      const C = ctx.table('product.Category')
      const wanted = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
      if (wanted && !wanted.size) return []
      // Children answer the tree picker. An id lookup walks parents instead, so
      // preloading them there is work nobody reads.
      const base = from(C).orderBy(asc(C.name))
      const rows = await ctx.db.all(wanted ? base : base.preload('children'))
      // A category is a node in a tree, and two branches may well hold a "Shirts".
      // `path` spells the ancestry out so a flat picker list stays unambiguous;
      // it is derived here rather than stored, and searching matches on it too.
      const byId = new Map(rows.map((row) => [String(row.id), row]))
      const pathOf = (row: Row): string => {
        const parts: string[] = []
        const seen = new Set<string>()
        let cursor: Row | undefined = row
        while (cursor && !seen.has(String(cursor.id))) {
          seen.add(String(cursor.id))
          parts.unshift(String(cursor.name))
          cursor = cursor.parentId == null ? undefined : byId.get(String(cursor.parentId))
        }
        return parts.join(' / ')
      }
      return narrow(
        rows
          .filter((row) => (wanted ? wanted.has(String(row.id)) : true))
          .map((row) => ({ ...row, path: pathOf(row) })),
        args,
        ['name', 'path'],
      )
    },
  }),

  saveCategory: defineFn({
    input: { id: 'id', name: 'text', parentId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Category', 'write:product.Category'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (args.parentId === args.id)
        return {
          ok: false,
          errors: [{ field: 'parentId', message: 'một danh mục không thể là cha của chính nó' }],
        }
      if (args.parentId) {
        const seen = new Set<string>([String(args.id)])
        let cursor: string | null = String(args.parentId)
        while (cursor) {
          if (seen.has(cursor))
            return { ok: false, errors: [{ field: 'parentId', message: 'cây danh mục có vòng lặp' }] }
          seen.add(cursor)
          const parent: Row | undefined = (await ctx.db.select('product.Category', { id: cursor }))[0]
          if (!parent)
            return { ok: false, errors: [{ field: 'parentId', message: 'danh mục cha không tồn tại' }] }
          cursor = parent.parentId == null ? null : String(parent.parentId)
        }
      }
      const existing = (await ctx.db.select('product.Category', { id: args.id }))[0]
      const cs = ctx
        .change('product.Category', args, existing ?? null)
        .cast(['id', 'name', 'parentId'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
}
