import { randomUUID } from 'node:crypto'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import productMedia from '../product_media/index.ts'
import { createProductMediaFunctions } from '../product_media/functions.ts'
import { fail } from './helpers.ts'

/** Compose only for deployments with Catalog: ERP media commands retain the native owner contract. */
export function productMediaWithWebsiteCatalog() {
  const functions = { ...productMedia.functions } as Record<string, FnSpec>
  const transactional = createProductMediaFunctions({ inTransaction: true })
  for (const [name, original] of Object.entries(functions)) {
    if (!original.effects?.includes('write:product_media.Media')) continue
    functions[name] = {
      ...original,
      effects: [
        ...new Set([
          ...original.effects,
          'read:product.Template',
          'write:product.Template',
          'read:website_catalog.Binding',
          'read:storage.Attachment',
          'read:website_catalog.Template',
          'read:website_catalog.Category',
          'write:storage.Attachment',
        ]),
      ],
      handler: async (ctx, args) =>
        ctx.tx(async (tx) => {
          const before = args.id ? (await tx.db.select('product_media.Media', { id: args.id }))[0] : null
          if (name === 'removeMedia' && before) {
            const url = `/website/catalog/files/${before.attachmentId}`
            const bindings = await tx.db.select('website_catalog.Binding')
            const templates = await tx.db.select('website_catalog.Template')
            const categories = await tx.db.select('website_catalog.Category')
            if (
              bindings.some((row) => JSON.stringify([row.contentLayout, row.overrides]).includes(url)) ||
              templates.some((row) => JSON.stringify(row.layout).includes(url)) ||
              categories.some((row) => JSON.stringify(row.layout).includes(url))
            )
              fail(
                'Ảnh đang được dùng trong nội dung riêng của website. Đổi hoặc bỏ ảnh ở website trước khi gỡ.',
              )
          }
          const result = (await transactional[name]!.handler(tx, args)) as Row
          if (result?.ok === false) return result
          const templateId = args.templateId ?? before?.templateId
          if (!templateId) return result
          const exposed =
            (await tx.db.select('website_catalog.Binding', { productId: templateId, visible: true })).length >
            0
          // An exposed master has explicitly opted into public media. A private unlinked ERP master has not.
          if (exposed && name === 'attachMedia' && args.attachmentId) {
            const attachment = (await tx.db.select('storage.Attachment', { id: args.attachmentId }))[0]
            if (attachment?.resModel === 'product.Template' && attachment.resId === templateId)
              await tx.db.update('storage.Attachment', { id: attachment.id }, { public: true })
          }
          await tx.db.update('product.Template', { id: templateId }, { revisionId: randomUUID() })
          return result
        }),
    }
  }
  return { ...productMedia, functions }
}
