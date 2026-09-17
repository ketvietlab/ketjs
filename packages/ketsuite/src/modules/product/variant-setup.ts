// A template's attributes and variants, read and saved as one editable setup.
//
// The record modal's "Attributes & variants" tab edits both halves together — the
// attribute lines with their values and price extras above, the variant rows below
// — and saves them with one button. Saving them through the per-line and
// per-variant functions would leave a half-written template whenever the third of
// five calls was refused, so `saveVariantSetup` validates the whole payload first
// and writes it in one transaction.
//
// A variant is never deleted here. It may already sit on an order line in a module
// this one cannot see, so a variant that leaves the setup is archived, the same
// way `generateVariants` retires a combination that no longer exists.

import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { type RecordImage, variantImagesOf } from './record-images.ts'

export type VariantSetupValue = { valueId: string; name: string; priceExtra: string }

export type VariantSetupLine = {
  attributeId: string
  name: string
  createVariant: string
  displayType: string
  values: VariantSetupValue[]
}

export type VariantSetupAttribute = {
  attributeId: string
  name: string
  createVariant: string
  values: Array<{ valueId: string; name: string }>
}

export type VariantSetupVariant = {
  id: string
  /** The value chosen for each variant-creating attribute, by attribute id. */
  valueIds: Record<string, string>
  defaultCode: string | null
  barcode: string | null
  weight: string
  volume: string
  active: boolean
  /** Primary first; empty without product_media or before the first upload. */
  images: RecordImage[]
}

export type VariantSetup = {
  templateId: string
  listPrice: string
  lines: VariantSetupLine[]
  catalogue: VariantSetupAttribute[]
  variants: VariantSetupVariant[]
}

type Issue = { field: string; message: string; code: string; params?: Record<string, unknown> }

const bySequence = (a: Row, b: Row) =>
  Number(a.sequence ?? 10) - Number(b.sequence ?? 10) || String(a.name).localeCompare(String(b.name))

const decimalText = (value: unknown, fallback = '0'): string => {
  const raw = String(value ?? '').trim()
  return raw === '' ? fallback : raw
}

const isDecimal = (value: string): boolean => /^-?\d+(\.\d+)?$/.test(value)

const lineIdFor = (templateId: string, attributeId: string): string => `${templateId}:${attributeId}`
const templateValueIdFor = (lineId: string, valueId: string): string => `${lineId}:${valueId}`

/** Everything the editor shows for one template, in the order it shows it. */
export const variantSetupOf = async (ctx: Ctx, templateId: string): Promise<VariantSetup | null> => {
  const template = (await ctx.db.select('product.Template', { id: templateId }))[0]
  if (!template) return null
  const [attributeRows, valueRows, lineRows, templateValueRows, productRows, productValueRows] =
    await Promise.all([
      ctx.db.select('product.Attribute'),
      ctx.db.select('product.AttributeValue'),
      ctx.db.select('product.TemplateAttributeLine', { templateId }),
      ctx.db.select('product.TemplateAttributeValue'),
      ctx.db.select('product.Product', { templateId }),
      ctx.db.select('product.ProductValue'),
    ])
  const attributes = new Map(attributeRows.map((row) => [String(row.id), row]))
  const values = new Map(valueRows.map((row) => [String(row.id), row]))
  const lineIds = new Set(lineRows.map((row) => String(row.id)))
  const templateValues = new Map(
    templateValueRows.filter((row) => lineIds.has(String(row.lineId))).map((row) => [String(row.id), row]),
  )
  const lineAttribute = new Map(lineRows.map((row) => [String(row.id), String(row.attributeId)]))

  const lines: VariantSetupLine[] = lineRows
    .map((line) => ({ line, attribute: attributes.get(String(line.attributeId)) }))
    .filter((entry): entry is { line: Row; attribute: Row } => Boolean(entry.attribute))
    .sort((a, b) => bySequence(a.attribute, b.attribute))
    .map(({ line, attribute }) => ({
      attributeId: String(attribute.id),
      name: String(attribute.name),
      createVariant: String(attribute.createVariant ?? 'always'),
      displayType: String(attribute.displayType ?? 'select'),
      values: [...templateValues.values()]
        .filter((row) => String(row.lineId) === String(line.id))
        .map((row) => ({ row, value: values.get(String(row.valueId)) }))
        .filter((entry): entry is { row: Row; value: Row } => Boolean(entry.value))
        .sort((a, b) => bySequence(a.value, b.value))
        .map(({ row, value }) => ({
          valueId: String(value.id),
          name: String(value.name),
          priceExtra: decimalText(row.priceExtra),
        })),
    }))

  const catalogue: VariantSetupAttribute[] = attributeRows
    .filter((row) => row.active !== false)
    .sort(bySequence)
    .map((attribute) => ({
      attributeId: String(attribute.id),
      name: String(attribute.name),
      createVariant: String(attribute.createVariant ?? 'always'),
      values: valueRows
        .filter((value) => String(value.attributeId) === String(attribute.id))
        .sort(bySequence)
        .map((value) => ({ valueId: String(value.id), name: String(value.name) })),
    }))

  const chosen = new Map<string, Record<string, string>>()
  for (const link of productValueRows) {
    const templateValue = templateValues.get(String(link.templateAttributeValueId))
    if (!templateValue) continue
    const attributeId = lineAttribute.get(String(templateValue.lineId))
    if (!attributeId) continue
    const held = chosen.get(String(link.productId)) ?? {}
    held[attributeId] = String(templateValue.valueId)
    chosen.set(String(link.productId), held)
  }

  const combinationRows = productRows.filter((row) => String(row.combinationKey ?? '') !== '')
  const images = await variantImagesOf(
    ctx,
    combinationRows.map((row) => String(row.id)),
  )
  const variants: VariantSetupVariant[] = combinationRows
    .sort(
      (a, b) =>
        Number(b.active !== false) - Number(a.active !== false) ||
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map((row) => ({
      id: String(row.id),
      valueIds: chosen.get(String(row.id)) ?? {},
      defaultCode: row.defaultCode == null ? null : String(row.defaultCode),
      barcode: row.barcode == null ? null : String(row.barcode),
      weight: decimalText(row.weight),
      volume: decimalText(row.volume),
      active: row.active !== false,
      images: images.get(String(row.id)) ?? [],
    }))

  return { templateId, listPrice: decimalText(template.listPrice), lines, catalogue, variants }
}

type LineInput = { attributeId: string; values: Array<{ valueId: string; priceExtra: string }> }
type VariantInput = {
  id: string | null
  valueIds: Record<string, string>
  defaultCode: string | null
  barcode: string | null
  weight: string
  volume: string
  active: boolean
}

const text = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  return raw === '' ? null : raw
}

const readLines = (raw: unknown): LineInput[] =>
  (Array.isArray(raw) ? raw : []).map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>
    return {
      attributeId: String(line.attributeId ?? ''),
      values: (Array.isArray(line.values) ? line.values : []).map((item) => {
        const value = (item ?? {}) as Record<string, unknown>
        return { valueId: String(value.valueId ?? ''), priceExtra: decimalText(value.priceExtra) }
      }),
    }
  })

const readVariants = (raw: unknown): VariantInput[] =>
  (Array.isArray(raw) ? raw : []).map((entry) => {
    const variant = (entry ?? {}) as Record<string, unknown>
    const valueIds = (variant.valueIds ?? {}) as Record<string, unknown>
    return {
      id: text(variant.id),
      valueIds: Object.fromEntries(
        Object.entries(valueIds).map(([key, value]) => [key, String(value ?? '')]),
      ),
      defaultCode: text(variant.defaultCode),
      barcode: text(variant.barcode),
      weight: decimalText(variant.weight),
      volume: decimalText(variant.volume),
      active: variant.active !== false,
    }
  })

export const variantSetupFunctions: Record<string, FnSpec> = {
  /**
   * Replace a template's attribute lines and variants with the submitted setup.
   *
   * Every active variant must pick exactly one value of every variant-creating
   * line, and no two variants may share a combination — the unique index on
   * `(templateId, combinationKey)` would refuse it anyway, but only after half the
   * rows were written, and without saying which rows collided.
   */
  saveVariantSetup: defineFn({
    input: { templateId: 'id', lines: 'json', variants: 'json' },
    output: { ok: 'bool', created: 'int?', archived: 'int?', setup: 'json?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.Product',
      'read:product.ProductValue',
      'read:product_media.Media',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
      'write:product.Product',
      'write:product.ProductValue',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const templateId = String(args.templateId)
      if (!(await ctx.db.select('product.Template', { id: templateId }))[0])
        return {
          ok: false,
          errors: [{ field: 'templateId', code: 'not_found', message: 'template không tồn tại' }],
        }
      const lines = readLines(args.lines)
      const variants = readVariants(args.variants)
      const [attributeRows, valueRows, productRows] = await Promise.all([
        ctx.db.select('product.Attribute'),
        ctx.db.select('product.AttributeValue'),
        ctx.db.select('product.Product', { templateId }),
      ])
      const attributes = new Map(attributeRows.map((row) => [String(row.id), row]))
      const values = new Map(valueRows.map((row) => [String(row.id), row]))
      const errors: Issue[] = []

      // ── Attribute lines ──
      const seenAttributes = new Set<string>()
      lines.forEach((line, index) => {
        const attribute = attributes.get(line.attributeId)
        if (!attribute) {
          errors.push({
            field: `lines.${index}.attributeId`,
            code: 'not_found',
            message: 'thuộc tính không tồn tại',
          })
          return
        }
        if (seenAttributes.has(line.attributeId))
          errors.push({
            field: `lines.${index}.attributeId`,
            code: 'duplicate',
            message: 'thuộc tính bị lặp',
          })
        seenAttributes.add(line.attributeId)
        const seenValues = new Set<string>()
        line.values.forEach((entry, position) => {
          const value = values.get(entry.valueId)
          if (!value || String(value.attributeId) !== line.attributeId)
            errors.push({
              field: `lines.${index}.values.${position}`,
              code: 'not_in_attribute',
              message: 'giá trị không thuộc thuộc tính này',
            })
          if (seenValues.has(entry.valueId))
            errors.push({
              field: `lines.${index}.values.${position}`,
              code: 'duplicate',
              message: 'giá trị bị lặp',
            })
          seenValues.add(entry.valueId)
          if (!isDecimal(entry.priceExtra))
            errors.push({
              field: `lines.${index}.values.${position}.priceExtra`,
              code: 'invalid_decimal',
              message: 'giá cộng thêm phải là số',
            })
        })
      })

      // The combination key is spelled in `generateVariants`' own order — attribute
      // sequence, then line id — so generating afterwards finds these rows instead
      // of creating the same combinations a second time.
      const variantLines = lines
        .filter((line) => {
          const attribute = attributes.get(line.attributeId)
          return attribute && attribute.createVariant !== 'no_variant' && line.values.length > 0
        })
        .sort((a, b) => {
          const aa = attributes.get(a.attributeId)
          const bb = attributes.get(b.attributeId)
          return (
            Number(aa?.sequence ?? 10) - Number(bb?.sequence ?? 10) ||
            lineIdFor(templateId, a.attributeId).localeCompare(lineIdFor(templateId, b.attributeId))
          )
        })

      // ── Variants ──
      const existing = new Map(productRows.map((row) => [String(row.id), row]))
      const keys = new Map<string, number>()
      const barcodes = new Map<string, number>()
      const resolved = variants.map((variant, index) => {
        if (variant.id && !existing.has(variant.id))
          errors.push({
            field: `variants.${index}.id`,
            code: 'not_found',
            message: 'biến thể không thuộc sản phẩm này',
          })
        const combination: string[] = []
        for (const line of variantLines) {
          const chosen = variant.valueIds[line.attributeId] ?? ''
          if (!line.values.some((value) => value.valueId === chosen)) {
            if (variant.active)
              errors.push({
                field: `variants.${index}.valueIds.${line.attributeId}`,
                code: 'required',
                message: 'chưa chọn giá trị',
              })
            continue
          }
          combination.push(chosen)
        }
        const key = combination.length === variantLines.length ? combination.join(',') : ''
        if (variant.active && variantLines.length === 0)
          errors.push({
            field: `variants.${index}`,
            code: 'no_attributes',
            message: 'chưa có thuộc tính tạo biến thể',
          })
        if (key) {
          const other = keys.get(key)
          if (other !== undefined) {
            errors.push({
              field: `variants.${index}.combination`,
              code: 'duplicate_combination',
              message: 'tổ hợp trùng',
              params: { row: other },
            })
            errors.push({
              field: `variants.${other}.combination`,
              code: 'duplicate_combination',
              message: 'tổ hợp trùng',
              params: { row: index },
            })
          } else keys.set(key, index)
        }
        if (!isDecimal(variant.weight))
          errors.push({ field: `variants.${index}.weight`, code: 'invalid_decimal', message: 'phải là số' })
        if (!isDecimal(variant.volume))
          errors.push({ field: `variants.${index}.volume`, code: 'invalid_decimal', message: 'phải là số' })
        if (variant.barcode) {
          const other = barcodes.get(variant.barcode)
          if (other !== undefined)
            errors.push({ field: `variants.${index}.barcode`, code: 'duplicate', message: 'barcode bị lặp' })
          else barcodes.set(variant.barcode, index)
        }
        return { ...variant, key }
      })
      // An inactive row the editor could not resolve to a full combination keeps the
      // key it already had — archiving a variant must not need its values re-picked.
      for (const [index, variant] of resolved.entries())
        if (!variant.key && !variant.active && variant.id) {
          const previous = existing.get(variant.id)
          const key = String(previous?.combinationKey ?? '')
          resolved[index] = { ...variant, key: key && !keys.has(key) ? key : `archived:${variant.id}` }
        }

      for (const [barcode, index] of barcodes) {
        const owner = (await ctx.db.select('product.Product', { barcode }))[0]
        if (owner && String(owner.templateId) !== templateId)
          errors.push({ field: `variants.${index}.barcode`, code: 'taken', message: 'barcode đã được dùng' })
      }
      if (errors.length) return { ok: false, errors }

      let created = 0
      let archived = 0
      await ctx.tx(async (tx) => {
        const Line = tx.table('product.TemplateAttributeLine')
        const TemplateValue = tx.table('product.TemplateAttributeValue')
        const ProductValue = tx.table('product.ProductValue')

        // Lines and their values: drop what left, add what came, keep price extras current.
        const currentLines = await tx.db.select('product.TemplateAttributeLine', { templateId })
        const wantedAttributes = new Set(lines.map((line) => line.attributeId))
        for (const line of currentLines) {
          const templateValueRows = await tx.db.select('product.TemplateAttributeValue', { lineId: line.id })
          const leaving = !wantedAttributes.has(String(line.attributeId))
          const wanted = new Set(
            (lines.find((entry) => entry.attributeId === String(line.attributeId))?.values ?? []).map(
              (value) => templateValueIdFor(String(line.id), value.valueId),
            ),
          )
          for (const row of templateValueRows)
            if (leaving || !wanted.has(String(row.id))) {
              await tx.db.del(
                deleteFrom(ProductValue).where(eq(ProductValue.templateAttributeValueId, row.id)),
              )
              await tx.db.del(deleteFrom(TemplateValue).where(eq(TemplateValue.id, row.id)))
            }
          if (leaving) await tx.db.del(deleteFrom(Line).where(eq(Line.id, line.id)))
        }
        const templateValueIds = new Map<string, string>()
        for (const line of lines) {
          const held = currentLines.find((row) => String(row.attributeId) === line.attributeId)
          const lineId = held ? String(held.id) : lineIdFor(templateId, line.attributeId)
          if (!held)
            await tx.db.insert('product.TemplateAttributeLine', {
              id: lineId,
              templateId,
              attributeId: line.attributeId,
            })
          for (const value of line.values) {
            const id = templateValueIdFor(lineId, value.valueId)
            templateValueIds.set(value.valueId, id)
            const row = (await tx.db.select('product.TemplateAttributeValue', { id }))[0]
            if (row)
              await tx.db.update('product.TemplateAttributeValue', { id }, { priceExtra: value.priceExtra })
            else
              await tx.db.insert('product.TemplateAttributeValue', {
                id,
                lineId,
                valueId: value.valueId,
                priceExtra: value.priceExtra,
              })
          }
        }

        // Variants. Keys move in two passes — every row being written first parks on
        // a placeholder — so swapping the combinations of two rows never trips the
        // unique index halfway through.
        const submitted = new Set(resolved.flatMap((variant) => (variant.id ? [variant.id] : [])))
        const claimed = new Set(resolved.map((variant) => variant.key))
        for (const row of productRows) {
          const id = String(row.id)
          if (String(row.combinationKey ?? '') === '' || submitted.has(id)) continue
          // Left the setup: archived, and moved off any key a submitted row now needs.
          const patch: Row = {}
          if (row.active !== false) {
            patch.active = false
            archived++
          }
          if (claimed.has(String(row.combinationKey))) patch.combinationKey = `archived:${id}`
          if (Object.keys(patch).length) await tx.db.update('product.Product', { id }, patch)
        }
        for (const variant of resolved)
          if (variant.id && String(existing.get(variant.id)?.combinationKey) !== variant.key)
            await tx.db.update(
              'product.Product',
              { id: variant.id },
              { combinationKey: `pending:${variant.id}` },
            )

        for (const variant of resolved) {
          const fields = {
            defaultCode: variant.defaultCode,
            barcode: variant.barcode,
            weight: variant.weight,
            volume: variant.volume,
            combinationKey: variant.key,
            active: variant.active,
          }
          let id = variant.id
          if (id) {
            if (existing.get(id)?.active !== false && !variant.active) archived++
            await tx.db.update('product.Product', { id }, fields)
          } else {
            const base = `${templateId}:${variant.key}`
            id = base
            for (let n = 2; (await tx.db.select('product.Product', { id }))[0]; n++) id = `${base}:${n}`
            await tx.db.insert('product.Product', { id, templateId, ...fields })
            created++
          }
          await tx.db.del(deleteFrom(ProductValue).where(eq(ProductValue.productId, id)))
          if (variant.key.startsWith('archived:')) continue
          for (const valueId of Object.values(variant.valueIds)) {
            const templateAttributeValueId = templateValueIds.get(valueId)
            if (
              !templateAttributeValueId ||
              !variantLines.some((line) => line.values.some((v) => v.valueId === valueId))
            )
              continue
            await tx.db.insert('product.ProductValue', {
              id: `${id}:${templateAttributeValueId}`,
              productId: id,
              templateAttributeValueId,
            })
          }
        }

        // The no-combination variant sells only while nothing else does.
        const selling = resolved.some((variant) => variant.active)
        const defaultVariant = productRows.find((row) => String(row.combinationKey ?? '') === '')
        if (defaultVariant)
          await tx.db.update('product.Product', { id: defaultVariant.id }, { active: !selling })
        else if (!selling)
          await tx.db.insert('product.Product', {
            id: `${templateId}:default`,
            templateId,
            defaultCode: null,
            barcode: null,
            weight: '0',
            volume: '0',
            combinationKey: '',
            active: true,
          })
      })

      return { ok: true, created, archived, setup: await variantSetupOf(ctx, templateId) }
    },
  }),
}
