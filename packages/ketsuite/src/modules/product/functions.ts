import { asc, defineFn, deleteFrom, eq, from, like } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { PRODUCT_TYPES } from './types.ts'

const templateQuery = (ctx: Ctx, args: { type?: string | null; search?: string | null }) => {
  const T = ctx.table('product.Template')
  let query = from(T).where(eq(T.active, true)).orderBy(asc(T.name))
  if (args.type != null) query = query.where(eq(T.type, args.type))
  if (args.search) query = query.where(like(T.name, `%${args.search}%`))
  return query
}

const productExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  Boolean((await ctx.db.select('product.Product', { id }))[0])

const uomRoot = (row: Row): string => String(row.parentPath).split('/').filter(Boolean)[0] ?? ''

export const functions: Record<string, FnSpec> = {
  listVariants: defineFn({
    input: { templateId: 'id' },
    effects: ['read:product.Product'],
    agent: true,
    handler: (ctx, args) => ctx.db.select('product.Product', { templateId: args.templateId }),
  }),

  getVariant: defineFn({
    input: { id: 'id' },
    effects: ['read:product.Product', 'read:product.Cost', 'read:product.ProductUom'],
    agent: true,
    handler: async (ctx, args) => {
      const product = (await ctx.db.select('product.Product', { id: args.id }))[0]
      if (!product) return null
      return {
        ...product,
        cost: (await ctx.db.select('product.Cost', { productId: args.id }))[0] ?? null,
        uoms: await ctx.db.select('product.ProductUom', { productId: args.id }),
      }
    },
  }),

  listAttributes: defineFn({
    input: {},
    effects: ['read:product.Attribute', 'read:product.AttributeValue'],
    agent: true,
    handler: (ctx) => {
      const A = ctx.table('product.Attribute')
      return ctx.db.all(from(A).orderBy(asc(A.sequence), asc(A.name)).preload('values'))
    },
  }),

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
      return rows
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
      const existing = (await ctx.db.select('product.Cost', { productId: args.productId }))[0]
      const id = existing?.id ?? `${ctx.scope.company}:${String(args.productId)}`
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
      if (!(await productExists(ctx, args.productId)))
        return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
      const unit = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
      if (!unit) return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị không tồn tại' }] }
      const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]!
      const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
      const primary = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : null
      if (!primary || uomRoot(primary) !== uomRoot(unit))
        return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị phải cùng cây với UoM mặc định' }] }
      const id = `${String(args.productId)}:${String(args.uomId)}`
      if (args.barcode) {
        const collision = (await ctx.db.select('product.ProductUom', { barcode: args.barcode }))[0]
        if (collision && collision.id !== id)
          return { ok: false, errors: [{ field: 'barcode', message: 'barcode đã được dùng trong company' }] }
      }
      const existing = (await ctx.db.select('product.ProductUom', { id }))[0]
      if (existing) await ctx.db.update('product.ProductUom', { id }, { barcode: args.barcode ?? null })
      else
        await ctx.db.insert('product.ProductUom', {
          id,
          productId: args.productId,
          uomId: args.uomId,
          barcode: args.barcode ?? null,
        })
      await ctx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
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
