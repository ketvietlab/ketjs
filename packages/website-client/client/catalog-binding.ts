import type { Placement } from './types.ts'

/** A source adapter supplies public data once; bindings never evaluate code or arbitrary paths. */
export type CatalogProduct = {
  id: string
  name: string
  type: 'goods' | 'service'
  description: string
  summaryDoc: string
  descriptionDoc: string
  gallery: { src: string; alt?: string }[]
  category: string
  websiteContent?: Placement[]
  active?: boolean
}

export const catalogFields = Object.freeze({
  'product.name': { setting: 'heading', kind: 'text' },
  'product.summaryDoc': { setting: 'bodyDoc', kind: 'document' },
  'product.descriptionDoc': { setting: 'bodyDoc', kind: 'document' },
  'product.gallery': { setting: 'images', kind: 'images' },
})

export type DetailTemplate = {
  id: string
  title: string
  revisionId: string
  productType: 'service' | 'goods'
  layout: Placement[]
  bindings: { nodeId: string; field: keyof typeof catalogFields }[]
}

export function bindCatalogTemplate(template: DetailTemplate, product: CatalogProduct): Placement[] {
  const layout = structuredClone(template.layout)
  const nodes = new Map<string, Placement>()
  const walk = (items: Placement[]) => {
    for (const item of items) {
      if (nodes.has(item.id)) throw new Error('duplicateNode')
      nodes.set(item.id, item)
      for (const children of Object.values(item.slots ?? {})) walk(children)
    }
  }
  walk(layout)
  if (template.productType !== product.type) throw new Error('productType')
  for (const binding of template.bindings) {
    const spec = Object.hasOwn(catalogFields, binding.field) ? catalogFields[binding.field] : null
    const node = nodes.get(binding.nodeId)
    if (!spec || !node) throw new Error('invalidBinding')
    node.settings ??= {}
    const value = product[binding.field.slice(8) as keyof CatalogProduct]
    if (spec.kind === 'images') {
      if (node.type !== 'website.gallery' || !Array.isArray(value)) throw new Error('bindingType')
      node.settings.images = JSON.stringify(value)
    } else {
      if (node.type !== 'website.rich_text' || typeof value !== 'string') throw new Error('bindingType')
      node.settings[spec.setting] = value
    }
  }
  return [...layout, ...structuredClone(product.websiteContent ?? [])]
}
