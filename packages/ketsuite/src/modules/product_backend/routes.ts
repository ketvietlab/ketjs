import { randomUUID } from 'node:crypto'
import { page, text, withHeaders } from 'ketjs'
import type { RouteEntry, Route, ServeContext } from 'ketjs'
import {
  attributesScreen,
  newProductScreen,
  productDetailScreen,
  productsScreen,
  variantScreen,
  VIEWS,
} from './screens.ts'
import type { TemplateRow, View } from './screens.ts'
import { viewerOf } from '../backend/routes.ts'
import { PAGE_SIZE, colsHref, colsOf, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import type { Extras } from '../../ui/index.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'

type MediaRow = {
  id: string
  attachmentId: string
  alt?: string | null
  primary: boolean
  attachment?: { name?: string; mimetype?: string }
}
type AnyVariant = Record<string, unknown> | null

const seeProduct = (id: string) =>
  withHeaders(text('', { status: 303 }), { location: `/admin/products/${id}` })
const seeVariant = (templateId: string, productId: string) =>
  seeOther(`/admin/products/${templateId}/variants/${productId}`)

const frameFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const optionsFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [units, categories, attributes] = (await Promise.all([
    ctx.call('uom.listUnits', {}, url, req),
    ctx.call('product.listCategories', {}, url, req),
    ctx.call('product.listAttributes', {}, url, req),
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>]
  return {
    uoms: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
    categories: categories.map((row) => ({ value: String(row.id), label: String(row.name) })),
    attributes: attributes.map((row) => ({ value: String(row.id), label: String(row.name) })),
  }
}

const invalidErrors = (url: URL, _: ReturnType<ServeContext['translate']>) =>
  url.searchParams.has('invalid') ? [_('product_backend.error.invalid')] : undefined

const mediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], templateId: string) =>
  ctx.call('product_media.listMedia', { templateId }, url, req) as Promise<MediaRow[]>

const variantMediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], productId: string) =>
  ctx.call('product_media.listMedia', { productId }, url, req) as Promise<MediaRow[]>

const ownsMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
) => (await mediaFor(ctx, url, req, templateId)).some((row) => row.id === mediaId)

const ownsVariantMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  productId: string,
  mediaId: string,
) => (await variantMediaFor(ctx, url, req, productId)).some((row) => row.id === mediaId)

/**
 * The catalogue screen.
 *
 * A route of this module, not of backend — the bridge owns the page it links to,
 * so installing the admin without the catalogue leaves neither the entry nor the
 * page behind. Closed by default, like every module route: a stranger gets the
 * sign-in page.
 *
 * Everything the list is doing — which page, which search, which view — is in the
 * URL. Nothing here holds state between requests.
 */
export const routes: Record<string, RouteEntry> = {
  '/admin/products':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const asked = url.searchParams.get('view')
      const view: View = (VIEWS as readonly string[]).includes(asked ?? '') ? (asked as View) : 'list'
      const search = searchOf(url)
      const current = pageOf(url)

      const filter = { search }
      const rows = (await ctx.call(
        'product.listTemplates',
        {
          ...filter,
          withVariants: true,
          limit: PAGE_SIZE,
          offset: (current - 1) * PAGE_SIZE,
        },
        url,
        req,
      )) as Array<{
        id: string
        name: string
        type: string
        categoryId: string | null
        uomId: string | null
        variants?: unknown[]
      }>
      const { count } = (await ctx.call('product.countTemplates', filter, url, req)) as { count: number }

      const extras: Extras = {
        'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
        'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
      }
      return page({
        body: ctx.document({
          lang,
          title: 'KetSuite',
          head: await ctx.styles(req),
          body: productsScreen(
            _,
            rows.map(
              (r): TemplateRow => ({
                id: r.id,
                name: r.name,
                type: r.type,
                categoryId: r.categoryId,
                uomId: r.uomId,
                variants: Array.isArray(r.variants) ? r.variants.length : 0,
              }),
            ),
            view,
            {
              viewer: await viewerOf(ctx, url, req),
              extras,
              menu: await ctx.menu(url, req),
              menuFilter: url.searchParams.get('menu')?.trim() || null,
              chrome: {
                search: {
                  name: 'q',
                  value: search ?? '',
                  placeholder: _('product_backend.chrome.search'),
                  // Searching must not silently switch you back to the list view.
                  keep: view === 'list' ? {} : { view },
                  facets: search
                    ? [
                        {
                          label: `${_('backend.chrome.searchFacet')}: ${search}`,
                          without: withParam(url, 'q', null),
                        },
                      ]
                    : [],
                },
                pager: pager(url, current, rows.length, count),
                views: VIEWS.map((v) => ({
                  id: v,
                  label: _(`backend.chrome.view.${v}`),
                  icon: v === 'kanban' ? 'layout-grid' : 'list',
                  path: withParam(url, 'view', v),
                  active: v === view,
                })),
              },
            },
            { shown: colsOf(url), colsHref: colsHref(url) },
          ),
        }),
      })
    },
  '/admin/products/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id,
            name: form.name ?? '',
            type: form.type || 'goods',
            ...(form.uomId ? { uomId: form.uomId } : {}),
            ...(form.categoryId ? { categoryId: form.categoryId } : {}),
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeProduct(id)
          : seeOther(`/admin/products/new?invalid=1&count=${errorsOf(result).length}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const options = await optionsFor(ctx, url, req)
      return page({
        body: ctx.document({
          lang,
          title: _('product_backend.create.title'),
          head: await ctx.styles(req),
          body: newProductScreen(
            _,
            { ...options, errors: invalidErrors(url, _) },
            await frameFor(ctx, url, req),
          ),
        }),
      })
    },
  '/admin/product-attributes':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'product.saveAttribute',
          {
            id: randomUUID(),
            name: form.name ?? '',
            sequence: Number(form.sequence || 10),
            displayType: form.displayType || 'radio',
            createVariant: form.createVariant || 'always',
            active: true,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther('/admin/product-attributes')
          : seeOther('/admin/product-attributes?invalid=1')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('product.listAttributes', {}, url, req)) as Array<Record<string, unknown>>
      return page({
        body: ctx.document({
          lang,
          title: _('product_backend.attributes.title'),
          head: await ctx.styles(req),
          body: attributesScreen(_, rows, await frameFor(ctx, url, req), invalidErrors(url, _)),
        }),
      })
    },
  '/admin/product-attributes/{id}/values':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'product.saveAttributeValue',
        {
          id: randomUUID(),
          attributeId: params.id,
          name: form.name ?? '',
          sequence: Number(form.sequence || 10),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther('/admin/product-attributes')
        : seeOther('/admin/product-attributes?invalid=1')
    },
  '/admin/products/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'product.saveTemplate',
          {
            id: params.id,
            name: form.name ?? '',
            type: form.type || 'goods',
            ...(form.uomId ? { uomId: form.uomId } : {}),
            ...(form.categoryId ? { categoryId: form.categoryId } : {}),
            description: form.description || null,
            listPrice: form.listPrice || '0',
            saleOk: form.saleOk === '1',
            purchaseOk: form.purchaseOk === '1',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeProduct(params.id)
          : seeOther(`/admin/products/${params.id}?invalid=1&count=${errorsOf(result).length}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const row = (await ctx.call('product.getTemplate', { id: params.id }, url, req)) as {
        id: string
        name: string
        type: string
        description?: string | null
        listPrice: number
        uomId: string | null
        categoryId?: string | null
        saleOk?: boolean
        purchaseOk?: boolean
      } | null
      if (!row) return text('Product not found', { status: 404 })
      const [mediaRows, variants, options] = await Promise.all([
        mediaFor(ctx, url, req, row.id),
        ctx.call('product.listVariants', { templateId: row.id }, url, req) as Promise<
          Array<{ id: string; defaultCode?: string | null; barcode?: string | null; active?: boolean }>
        >,
        optionsFor(ctx, url, req),
      ])
      return page({
        body: ctx.document({
          lang,
          title: row.name,
          head: await ctx.styles(req),
          body: productDetailScreen(
            _,
            row,
            {
              status: 'ready',
              uploadAction: `/admin/products/${row.id}/media`,
              images: mediaRows.map((image, index) => ({
                id: image.id,
                src: `/files/${image.attachmentId}`,
                alt: image.alt || image.attachment?.name || row.name,
                primary: image.primary,
                actions: {
                  primary: `/admin/products/${row.id}/media/${image.id}/primary`,
                  remove: `/admin/products/${row.id}/media/${image.id}/remove`,
                  ...(index > 0 ? { moveUp: `/admin/products/${row.id}/media/${image.id}/move-up` } : {}),
                  ...(index + 1 < mediaRows.length
                    ? { moveDown: `/admin/products/${row.id}/media/${image.id}/move-down` }
                    : {}),
                },
              })),
              extension: await ctx.joint(url, req, 'product_backend:template.media', {
                templateId: row.id,
              }),
            },
            { ...options, variants, errors: invalidErrors(url, _) },
            await frameFor(ctx, url, req),
          ),
        }),
      })
    },
  '/admin/products/{id}/variants/generate':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const result = await ctx.call('product.generateVariants', { templateId: params.id }, url, req)
      return (result as { ok?: boolean }).ok
        ? seeProduct(params.id)
        : seeOther(`/admin/products/${params.id}?invalid=1`)
    },
  '/admin/products/{id}/attribute-lines':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const attributeId = form.attributeId ?? ''
      const result = await ctx.call(
        'product.saveAttributeLine',
        {
          id: `${params.id}:${attributeId}`,
          templateId: params.id,
          attributeId,
          valueIds: (form.valueIds ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeProduct(params.id)
        : seeOther(`/admin/products/${params.id}?invalid=1`)
    },
  '/admin/products/{id}/variants/{variantId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const current = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as Record<
        string,
        unknown
      > | null
      if (!current || current.templateId !== params.id) return text('Variant not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const saved = await ctx.call(
          'product.saveVariant',
          {
            id: params.variantId,
            templateId: params.id,
            defaultCode: form.defaultCode || null,
            barcode: form.barcode || null,
            weight: form.weight || '0',
            volume: form.volume || '0',
          },
          url,
          req,
        )
        if (!(saved as { ok?: boolean }).ok)
          return seeOther(`/admin/products/${params.id}/variants/${params.variantId}?invalid=1`)
        await ctx.call(
          'product.setCost',
          { productId: params.variantId, standardPrice: form.standardPrice || '0' },
          url,
          req,
        )
        if (form.uomId)
          await ctx.call(
            'product.addProductUom',
            { productId: params.variantId, uomId: form.uomId, barcode: form.uomBarcode || null },
            url,
            req,
          )
        return seeOther(`/admin/products/${params.id}/variants/${params.variantId}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [options, mediaRows] = await Promise.all([
        optionsFor(ctx, url, req),
        variantMediaFor(ctx, url, req, params.variantId),
      ])
      return page({
        body: ctx.document({
          lang,
          title: String(current.defaultCode || current.id),
          head: await ctx.styles(req),
          body: variantScreen(
            _,
            params.id,
            current,
            {
              status: 'ready',
              uploadAction: `/admin/products/${params.id}/variants/${params.variantId}/media`,
              images: mediaRows.map((image, index) => ({
                id: image.id,
                src: `/files/${image.attachmentId}`,
                alt: image.alt || image.attachment?.name || String(current.defaultCode || current.id),
                primary: image.primary,
                actions: {
                  primary: `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/primary`,
                  remove: `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/remove`,
                  ...(index > 0
                    ? {
                        moveUp: `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-up`,
                      }
                    : {}),
                  ...(index + 1 < mediaRows.length
                    ? {
                        moveDown: `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-down`,
                      }
                    : {}),
                },
              })),
              extension: await ctx.joint(url, req, 'product_backend:variant.media', {
                productId: params.variantId,
              }),
            },
            options.uoms,
            await frameFor(ctx, url, req),
            invalidErrors(url, _),
          ),
        }),
      })
    },
  '/admin/products/{id}/variants/{variantId}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
      const variant = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as AnyVariant
      if (!variant || variant.templateId !== params.id) return text('Variant not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Product',
        resId: params.variantId,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            productId: params.variantId,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeVariant(params.id, params.variantId)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, -1),
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, 1),
  '/admin/products/{id}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
      const template = await ctx.call('product.getTemplate', { id: params.id }, url, req)
      if (!template) return text('Product not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Template',
        resId: params.id,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            templateId: params.id,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeProduct(params.id)
    },
  '/admin/products/{id}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeProduct(params.id)
    },
  '/admin/products/{id}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeProduct(params.id)
    },
  '/admin/products/{id}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, -1),
  '/admin/products/{id}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, 1),
}

const move = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const rows = await mediaFor(ctx, url, req, templateId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { templateId, ids }, url, req)
  }
  return seeProduct(templateId)
}

const moveVariant = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  productId: string,
  mediaId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const rows = await variantMediaFor(ctx, url, req, productId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { productId, ids }, url, req)
  }
  return seeVariant(templateId, productId)
}
