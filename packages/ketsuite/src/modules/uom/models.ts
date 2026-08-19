import type { ModelDef } from 'ketjs'

/**
 * Units of measure, following Odoo's model deliberately.
 *
 * A category groups units that can convert between one another — weight, volume,
 * count. Exactly one unit in each category is the *reference*, and every other unit
 * records how it relates to it. Conversion across categories is not a rounding
 * problem, it is a mistake, and it is refused.
 *
 * `factor` is how many of THIS unit make one reference unit. Gram against a
 * kilogram reference is 1000; tonne is 0.001. The reference itself is 1.
 *
 * `rounding` is the precision this unit is meaningful to: 1 for whole pieces, 0.01
 * for kilograms weighed to the gram. Every conversion result is rounded to the
 * target's precision, because a quantity carried at full float precision is a
 * quantity that will eventually compare unequal to itself.
 */
export const models: Record<string, ModelDef> = {
  Category: {
    scope: 'shared',
    fields: { id: 'id', name: 'text' },
  },

  Unit: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      categoryId: 'ref:uom.Category',
      // 'reference' | 'bigger' | 'smaller' — validated on write, see functions.ts
      type: 'text',
      factor: 'float',
      rounding: 'float',
      active: 'bool',
    },
  },
}
