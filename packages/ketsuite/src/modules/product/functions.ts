import { asc, defineFn, eq, from, inArray, like } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { PRODUCT_TYPES } from './types.ts'

const templateQuery = (ctx: Ctx, args: { type?: string | null; search?: string | null }) => {
  const T = ctx.table('product.Template')
  let query = from(T).where(eq(T.active, true)).orderBy(asc(T.name))
  if (args.type != null) query = query.where(eq(T.type, args.type))
  if (args.search) query = query.where(like(T.name, `%${args.search}%`))
  return query
}

/**
 * Attach each template's primary unit.
 *
 * Restricted to the rows in hand: reading every primary link in the tenant to label
 * one page of PAGE_SIZE made the query grow with the catalogue while the page did
 * not, so a large catalogue paid for the whole table on every list request.
 */
const withPrimaryUom = async (ctx: Ctx, rows: Row[]): Promise<Row[]> => {
  if (!rows.length) return rows
  const L = ctx.table('product.TemplateUom')
  const links = await ctx.db.all(
    from(L)
      .where(eq(L.primary, true))
      .where(
        inArray(
          L.templateId,
          rows.map((row) => String(row.id)),
        ),
      ),
  )
  const byTemplate = new Map(links.map((link) => [link.templateId, link.uomId]))
  return rows.map((row) => ({ ...row, uomId: byTemplate.get(row.id) ?? null }))
}

const productExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  Boolean((await ctx.db.select('product.Product', { id }))[0])

export const functions: Record<string, FnSpec> = {
  listTemplates: defineFn({
    input: { withVariants: 'bool?', type: 'text?', search: 'text?', limit: 'int?', offset: 'int?' },
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
    },
    effects: ['read:product.Template', 'read:product.Product', 'read:product.TemplateUom'],
    agent: true,
    handler: async (ctx, args) => {
      let query = templateQuery(ctx, args)
      if (args.limit != null) query = query.limit(Number(args.limit))
      if (args.offset != null) query = query.offset(Number(args.offset))
      const rows = await ctx.db.all(args.withVariants === true ? query.preload('variants') : query)
      return withPrimaryUom(ctx, rows)
    },
  }),

  countTemplates: defineFn({
    input: { type: 'text?', search: 'text?' },
    output: { count: 'int' },
    effects: ['read:product.Template'],
    agent: true,
    handler: async (ctx, args) => ({ count: await ctx.db.count(templateQuery(ctx, args)) }),
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
      return row ? (await withPrimaryUom(ctx, [row]))[0] : null
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
    effects: [
      'read:product.Template',
      'write:product.Template',
      'read:product.TemplateUom',
      'write:product.TemplateUom',
      'read:uom.Unit',
    ],
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
        .cast(['id', 'name', 'type', 'categoryId', 'description', 'listPrice', 'saleOk', 'purchaseOk'])
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
        if (args.uomId) {
          const links = await tx.db.select('product.TemplateUom', { templateId: args.id })
          for (const link of links)
            if (link.primary && link.uomId !== args.uomId)
              await tx.db.update('product.TemplateUom', { id: link.id }, { primary: false })
          await tx.db.insertIfAbsent('product.TemplateUom', {
            id: `${args.id}:${args.uomId}`,
            templateId: args.id,
            uomId: args.uomId,
            primary: true,
          })
          await tx.db.update(
            'product.TemplateUom',
            { templateId: args.id, uomId: args.uomId },
            { primary: true },
          )
        }
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
    input: { id: 'id', name: 'text', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Attribute', 'write:product.Attribute'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('product.Attribute', { id: args.id }))[0]
      const values = { ...args, sequence: args.sequence ?? 10 }
      const cs = ctx
        .change('product.Attribute', values, existing ?? null)
        .cast(['id', 'name', 'sequence'])
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

  saveAttributeLine: defineFn({
    input: { id: 'id', templateId: 'id', attributeId: 'id', valueIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
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
      'write:product.Product',
      'write:product.ProductValue',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
      // Sorted, because select emits no ORDER BY: the values inside a group were
      // already ordered but the groups were not, so row order decided the combination
      // key and the product id derived from it. On an adapter free to reorder rows
      // that let one combination generate a second variant.
      const lines = (
        await ctx.db.select('product.TemplateAttributeLine', { templateId: args.templateId })
      ).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      const groups: string[][] = []
      for (const line of lines) {
        const values = await ctx.db.select('product.TemplateAttributeValue', { lineId: line.id })
        if (values.length) groups.push(values.map((value) => String(value.id)).sort())
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
        for (const values of combinations) {
          const combinationKey = values.join(',')
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
          ids.push(id)
          for (const templateAttributeValueId of values)
            await tx.db.insertIfAbsent('product.ProductValue', {
              id: `${id}:${templateAttributeValueId}`,
              productId: id,
              templateAttributeValueId,
            })
        }
      })
      return { ok: true, created, ids }
    },
  }),

  setCost: defineFn({
    input: { productId: 'id', amount: 'decimal' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'read:product.Cost', 'write:product.Cost'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await productExists(ctx, args.productId)))
        return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
      if (!ctx.scope.company)
        return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi giá vốn' }] }
      const existing = (await ctx.db.select('product.Cost', { productId: args.productId }))[0]
      const id = existing?.id ?? `${ctx.scope.company}:${String(args.productId)}`
      if (existing) await ctx.db.update('product.Cost', { id }, { amount: args.amount })
      else await ctx.db.insert('product.Cost', { id, productId: args.productId, amount: args.amount })
      return { ok: true, id }
    },
  }),

  addProductUom: defineFn({
    input: { productId: 'id', uomId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Product', 'read:uom.Unit', 'write:product.ProductUom'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await productExists(ctx, args.productId)))
        return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
      if (!(await ctx.db.select('uom.Unit', { id: args.uomId }))[0])
        return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị không tồn tại' }] }
      const id = `${String(args.productId)}:${String(args.uomId)}`
      await ctx.db.insertIfAbsent('product.ProductUom', { id, productId: args.productId, uomId: args.uomId })
      return { ok: true, id }
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

  listCategories: defineFn({
    input: {},
    output: { id: 'id', name: 'text', parentId: 'id?', children: 'json?' },
    effects: ['read:product.Category'],
    agent: true,
    handler: (ctx) =>
      ctx.db.all(
        from(ctx.table('product.Category'))
          .orderBy(asc(ctx.table('product.Category').name))
          .preload('children'),
      ),
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
