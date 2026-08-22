import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'
import type { RelationOption } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]

/**
 * The catalogue's relational fields, as pickers rather than bare selects.
 *
 * Each one lists through a function that already accepts `search` and `limit`,
 * which is what the picker sends on every keystroke, and creates through the
 * matching save function so a missing record does not send the user to another
 * screen and back.
 */

export const categoryControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; categories: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'categoryId',
    ariaLabel: _('product_backend.field.category'),
    value: options.value,
    required: options.required,
    // A category is a tree node, so the flat list is disambiguated by its
    // ancestry — `listCategories` derives `path` for exactly this.
    options: [{ value: '', label: '—' }, ...options.categories],
    labels: relationLabels(_, _('product_backend.relation.categories')),
    manager: {
      listFunction: 'product.listCategories',
      descriptionField: 'path',
      saveFunction: 'product.saveCategory',
      fields: [{ name: 'name', label: _('product_backend.field.category'), required: true }],
    },
  })

export const uomControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: {
    id: string
    value?: string | null
    units: RelationOption[]
    required?: boolean
    /**
     * Restricts the picker to one unit tree.
     *
     * A variant's unit has to share a root with its template's default unit or
     * the write is refused, so the constraint belongs in the list the user picks
     * from rather than in an error message after they submit.
     */
    rootId?: string | null
  },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'uomId',
    ariaLabel: _('product_backend.field.uom'),
    value: options.value,
    required: options.required,
    options: [{ value: '', label: '—' }, ...options.units],
    labels: relationLabels(_, _('product_backend.relation.units')),
    manager: {
      listFunction: 'uom.listUnits',
      ...(options.rootId ? { listInput: { rootId: options.rootId } } : {}),
      saveFunction: 'uom.saveUnit',
      // `relativeFactor` is required by saveUnit, and `relativeUomId` is what
      // keeps a new unit inside the tree the picker is restricted to.
      ...(options.rootId ? { saveDefaults: { relativeUomId: options.rootId } } : {}),
      fields: [
        { name: 'name', label: _('product_backend.field.uom'), required: true },
        { name: 'relativeFactor', label: _('product_backend.relation.unitFactor'), required: true },
      ],
    },
  })

export const attributeControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: { id: string; value?: string | null; attributes: RelationOption[]; required?: boolean },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'attributeId',
    ariaLabel: _('product_backend.attributes.attribute'),
    value: options.value,
    required: options.required,
    options: options.attributes,
    labels: relationLabels(_, _('product_backend.relation.attributes')),
    manager: {
      listFunction: 'product.listAttributes',
      saveFunction: 'product.saveAttribute',
      fields: [{ name: 'name', label: _('product_backend.field.name'), required: true }],
    },
  })

export const attributeValuesControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: {
    id: string
    values?: string[]
    choices: RelationOption[]
    attributeId?: string | null
    required?: boolean
  },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: 'valueIds',
    ariaLabel: _('product_backend.attributes.values'),
    multiple: true,
    values: options.values,
    required: options.required,
    options: options.choices,
    labels: relationLabels(_, _('product_backend.relation.attributeValues')),
    manager: {
      listFunction: 'product.listAttributeValues',
      ...(options.attributeId ? { listInput: { attributeId: options.attributeId } } : {}),
      saveFunction: 'product.saveAttributeValue',
      ...(options.attributeId ? { saveDefaults: { attributeId: options.attributeId } } : {}),
      fields: [{ name: 'name', label: _('product_backend.attributes.valueName'), required: true }],
    },
  })
