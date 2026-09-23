import { randomUUID } from 'node:crypto'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

const invalid = (field: string, reason: string) => ({
  ok: false,
  errors: [{ field, code: `product.error.attribute.${reason}` }],
})
const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const nameKey = (value: unknown): string => clean(value).normalize('NFC').toLowerCase()

export const attributeDraftFunctions: Record<string, FnSpec> = {
  /** Replace one attribute's ordered values without exposing a partially saved definition. */
  saveAttributeDraft: defineFn({
    input: {
      id: 'id',
      name: 'text',
      displayType: 'text',
      createVariant: 'text',
      sequence: 'int?',
      values: 'json',
    },
    output: { ok: 'bool', id: 'id?', values: 'json?', errors: 'json?' },
    effects: [
      'read:product.Attribute',
      'write:product.Attribute',
      'read:product.AttributeValue',
      'write:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const name = clean(args.name)
      if (!name) return invalid('name', 'required')
      if (!['radio', 'pills', 'select', 'color', 'multi'].includes(String(args.displayType)))
        return invalid('displayType', 'displayType')
      if (!['always', 'no_variant'].includes(String(args.createVariant)))
        return invalid('createVariant', 'createVariant')
      if (!Array.isArray(args.values)) return invalid('values', 'values')
      const values: Array<{ id: string; name: string; htmlColor: string | null; sequence: number }> = []
      const ids = new Set<string>()
      const names = new Set<string>()
      for (const [index, raw] of args.values.entries()) {
        const field = `values.${index}`
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid(field, 'values')
        if (raw.id != null && !clean(raw.id)) return invalid(`${field}.id`, 'valueId')
        const id = raw.id == null ? randomUUID() : clean(raw.id)
        if (ids.has(id)) return invalid(`${field}.id`, 'duplicateId')
        ids.add(id)
        const valueName = clean(raw.name)
        if (!valueName) return invalid(`${field}.name`, 'required')
        const key = nameKey(valueName)
        if (names.has(key)) return invalid(`${field}.name`, 'duplicateValue')
        names.add(key)
        if (raw.htmlColor != null && typeof raw.htmlColor !== 'string')
          return invalid(`${field}.htmlColor`, 'color')
        const htmlColor = clean(raw.htmlColor) || null
        if (htmlColor && !/^#[\da-f]{6}$/i.test(htmlColor)) return invalid(`${field}.htmlColor`, 'color')
        values.push({ id, name: valueName, htmlColor, sequence: index + 1 })
      }

      // Reads and validation share the write transaction; no parent/child writes
      // occur until every draft row and every removal has been checked.
      return ctx.tx(async (tx) => {
        const attributes = await tx.db.select('product.Attribute')
        const existing = attributes.find((row) => row.id === args.id)
        if (attributes.some((row) => row.id !== args.id && nameKey(row.name) === nameKey(name)))
          return invalid('name', 'duplicateName')
        if (
          existing &&
          existing.createVariant !== args.createVariant &&
          (await tx.db.select('product.TemplateAttributeLine', { attributeId: args.id })).length > 0
        )
          return invalid('createVariant', 'policyInUse')

        const current = await tx.db.select('product.AttributeValue', { attributeId: args.id })
        const currentById = new Map(current.map((row) => [String(row.id), row]))
        for (const [index, value] of values.entries()) {
          if (currentById.has(value.id)) continue
          if ((await tx.db.select('product.AttributeValue', { id: value.id })).length > 0)
            return invalid(`values.${index}.id`, 'foreignValue')
        }
        const removed = current.filter((value) => !ids.has(String(value.id)))
        for (const value of removed)
          if ((await tx.db.select('product.TemplateAttributeValue', { valueId: value.id })).length > 0)
            return invalid('values', 'valueInUse')

        const attributeChanges = tx
          .change(
            'product.Attribute',
            {
              id: args.id,
              name,
              displayType: args.displayType,
              createVariant: args.createVariant,
              sequence: args.sequence ?? existing?.sequence ?? 10,
              active: existing?.active ?? true,
            },
            existing ?? null,
          )
          .cast(['id', 'name', 'displayType', 'createVariant', 'sequence', 'active'])
          .required(['name'])
        if (!attributeChanges.valid) return { ok: false, errors: attributeChanges.errors }
        const valueChanges = values.map((value) =>
          tx
            .change(
              'product.AttributeValue',
              { ...value, attributeId: args.id },
              currentById.get(value.id) ?? null,
            )
            .cast(['id', 'attributeId', 'name', 'htmlColor', 'sequence'])
            .required(['attributeId', 'name']),
        )
        for (const [index, changes] of valueChanges.entries())
          if (!changes.valid)
            return {
              ok: false,
              errors: changes.errors.map((error) => ({ ...error, field: `values.${index}.${error.field}` })),
            }
        await tx.db.commit(attributeChanges, existing ? { id: args.id } : undefined)
        for (const [index, changes] of valueChanges.entries()) {
          const value = values[index]!
          await tx.db.commit(changes, currentById.has(value.id) ? { id: value.id } : undefined)
        }
        const Value = tx.table('product.AttributeValue')
        for (const value of removed) await tx.db.del(deleteFrom(Value).where(eq(Value.id, value.id)))
        return { ok: true, id: args.id, values }
      })
    },
  }),
}
