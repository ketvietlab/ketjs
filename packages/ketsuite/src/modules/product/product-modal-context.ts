// The record-modal context for a product template (KetSuite record-modal contract).
//
// The catalogue collection opens a template — and its create action — in a
// client-side modal. One permission-checked read hands that modal the General and
// Variants tabs need: the record or its defaults, the option lists their fields
// offer, the template's attributes-and-variants setup, and what the viewer may do.
// Media (the gallery, uploads) and the description's rich-text controller stay on
// the server-rendered detail page for now — this context does not answer for them.

import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordTabsFor } from './product-record-tabs.ts'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'
import { PRODUCT_TYPES } from './types.ts'
import { variantSetupOf } from './variant-setup.ts'
import { hasProductMedia, templateImagesOf } from './record-images.ts'

type Lang = 'vi' | 'en'
type Can = (fn: string) => boolean

/** Message prefixes the product views read. */
const MESSAGE_PREFIXES = ['product_backend.', 'product.', 'backend.relation.']

const messagesFor = (ctx: Ctx, lang: Lang): Record<string, string> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(catalog)) {
    if (!MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    out[key] =
      typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
  }
  return out
}

const readEffects = AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:'))

/** What the actor may call. A superuser (null) may call everything; no actor, nothing. */
const permissionCheck = async (ctx: Ctx): Promise<Can> => {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return (fn) => allowed === null || allowed.includes(fn)
}

const byName = (a: Row, b: Row) =>
  String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id))

const options = (rows: Row[]): Row[] =>
  rows.map((row) => ({ value: String(row.id), label: String(row.name ?? row.id) })).sort(byName)

const newTemplateRecord = (): Row => ({
  id: '',
  name: '',
  type: 'goods',
  categoryId: null,
  brandId: null,
  uomId: null,
  origin: null,
  description: null,
  listPrice: '0',
  saleOk: true,
  purchaseOk: true,
  defaultCode: null,
  barcode: null,
  active: true,
  isStorable: false,
  tracking: 'none',
  taxId: null,
})

export const productModalContextFunctions: Record<string, FnSpec> = {
  templateModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...readEffects,
      'read:product.Template',
      'read:product.Product',
      'read:product.ProductValue',
      'read:product.Category',
      'read:product.Brand',
      'read:uom.Unit',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.AttributeValue',
      'read:product.Attribute',
      'read:account.ProductTax',
      'read:account.Tax',
      'read:product_media.Media',
    ],
    handler: async (ctx, args) => {
      const can = await permissionCheck(ctx)
      // Both cross-module extensions this tab set touches: neither is a dependency
      // of `product`, so their functions may simply not be registered.
      const hasStock = Boolean(ctx.manifest.functions['stock.configureProduct'])
      const hasTax = Boolean(ctx.manifest.functions['account.setProductTax'])
      const permissions = {
        save: can('product.saveTemplate'),
        archive: can('product.archiveTemplate'),
        delete: can('product.deleteTemplates'),
        saveVariantSetup: can('product.saveVariantSetup'),
        setCost: can('product.setCost'),
        setProductUom: can('product.setProductUom'),
        // An image is two calls — the upload stores an attachment, then the gallery
        // links it — so the viewer needs both, and the gallery module composed at all.
        uploadImage:
          hasProductMedia(ctx) && can('storage.createAttachment') && can('product_media.attachMedia'),
        removeImage: hasProductMedia(ctx) && can('product_media.removeMedia'),
        configureStock: hasStock && can('stock.configureProduct'),
        setTax: hasTax && can('account.setProductTax'),
      }
      const creating = !args.id
      // The modal answers a create form only to whoever may save one, and an
      // existing template only to whoever may read it — the same split the
      // catalogue route enforced.
      if (creating ? !permissions.save : !can('product.getTemplate')) return null
      const record = creating
        ? newTemplateRecord()
        : (await ctx.db.select('product.Template', { id: args.id }))[0]
      if (!record) return null
      const [categoryRows, unitRows, brandRows, taxRows, taxLink] = await Promise.all([
        ctx.db.select('product.Category'),
        ctx.db.select('uom.Unit'),
        ctx.db.select('product.Brand', { active: true }),
        hasTax ? ctx.db.select('account.Tax', { typeTaxUse: 'sale' }) : Promise.resolve([]),
        hasTax && !creating
          ? ctx.db.select('account.ProductTax', { templateId: args.id })
          : Promise.resolve([]),
      ])
      const products = creating ? [] : await ctx.db.select('product.Product', { templateId: args.id })
      const defaultVariant = products.find((product) => String(product.combinationKey ?? '') === '')
      // Archived combinations do not count: once every variant is archived the
      // default one sells again, and General shows its code and barcode.
      const sellingVariants = products.filter(
        (product) => String(product.combinationKey ?? '') !== '' && product.active !== false,
      )
      const variantSetup = creating ? null : await variantSetupOf(ctx, String(args.id))
      const images = creating ? [] : await templateImagesOf(ctx, String(args.id))
      const lang: Lang = args.locale === 'en' ? 'en' : 'vi'
      return {
        data: {
          record: {
            id: String(record.id ?? ''),
            name: String(record.name ?? ''),
            type: String(record.type ?? 'goods'),
            categoryId: record.categoryId == null ? null : String(record.categoryId),
            brandId: record.brandId == null ? null : String(record.brandId),
            uomId: record.uomId == null ? null : String(record.uomId),
            origin: record.origin == null ? null : String(record.origin),
            description: record.description == null ? null : String(record.description),
            listPrice: String(record.listPrice ?? '0'),
            saleOk: record.saleOk !== false,
            purchaseOk: record.purchaseOk !== false,
            defaultCode: defaultVariant?.defaultCode ? String(defaultVariant.defaultCode) : null,
            barcode: defaultVariant?.barcode ? String(defaultVariant.barcode) : null,
            active: record.active !== false,
            isStorable: hasStock ? record.isStorable === true : false,
            tracking: hasStock ? String(record.tracking ?? 'none') : 'none',
            taxId: taxLink[0]?.taxId ? String(taxLink[0].taxId) : null,
          },
          images,
          hasVariants: sellingVariants.length > 0,
          variantSetup,
          types: [...PRODUCT_TYPES],
          categories: options(categoryRows),
          uoms: options(unitRows),
          brands: options(brandRows),
          taxes: options(taxRows),
          stockEnabled: hasStock,
          taxEnabled: hasTax,
          permissions,
          lang,
          extensionTabs: creating ? [] : recordTabsFor(ctx, lang),
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),
}
