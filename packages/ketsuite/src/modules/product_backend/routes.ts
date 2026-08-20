import { randomUUID } from 'node:crypto'
import { json, page, text, withHeaders } from 'ketjs'
import type { RouteEntry, Route, ServeContext } from 'ketjs'
import {
  PRODUCT_DETAIL_TABS,
  productDetailScreen,
  productsScreen,
  VARIANT_DETAIL_TABS,
  variantScreen,
  VIEWS,
} from './screens.ts'
import { attributesScreen } from './attributes-screen.tsx'
import { newProductScreen } from './create-screen.tsx'
import type { ProductDetailTab, TemplateRow, VariantDetailTab, View } from './screens.ts'
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

const localeSuffix = (url: URL): string => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}
const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}
const productTabOf = (url: URL): ProductDetailTab => {
  const asked = url.searchParams.get('tab')
  return (PRODUCT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as ProductDetailTab)
    : 'general'
}
const variantTabOf = (url: URL): VariantDetailTab => {
  const asked = url.searchParams.get('tab')
  return (VARIANT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as VariantDetailTab)
    : 'general'
}
const isProductPartial = (req: Parameters<Route>[1], scope = 'product-detail'): boolean =>
  req.headers['x-ket-partial'] === scope
const seeProduct = (id: string, url: URL, tab: ProductDetailTab = productTabOf(url)) =>
  withHeaders(text('', { status: 303 }), {
    location: inLocale(url, `/admin/products/${id}?tab=${tab}`),
  })
const seeVariant = (
  templateId: string,
  productId: string,
  url: URL,
  tab: VariantDetailTab = variantTabOf(url),
) => seeOther(inLocale(url, `/admin/products/${templateId}/variants/${productId}?tab=${tab}`))

const frameFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot': await ctx.joint(url, req, 'backend:sidebar.foot', {
      lang: ctx.localeOf(url, req),
    }),
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

const stockEnabled = async (ctx: ServeContext, req: Parameters<Route>[1]) =>
  Boolean((await ctx.live(req)).functions['stock.configureProduct'])

const TRACKING = ['none', 'lot', 'serial'] as const
const validStockForm = (form: Record<string, string>): boolean => {
  const tracking = form.tracking || 'none'
  return (
    (TRACKING as readonly string[]).includes(tracking) && (form.isStorable === '1' || tracking === 'none')
  )
}

const configureStock = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  form: Record<string, string>,
) =>
  ctx.call(
    'stock.configureProduct',
    {
      templateId,
      isStorable: form.isStorable === '1',
      tracking: form.tracking || 'none',
    },
    url,
    req,
  )

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
        'sidebar.foot': await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
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
                create: {
                  label: _('product_backend.action.create'),
                  path: inLocale(url, '/admin/products/new'),
                },
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
            localeSuffix(url),
          ),
        }),
      })
    },
  '/admin/products/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const hasStock = await stockEnabled(ctx, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (hasStock && !validStockForm(form))
          return seeOther(inLocale(url, '/admin/products/new?invalid=1&count=1'))
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
        if (!(result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/products/new?invalid=1&count=${errorsOf(result).length}`))
        if (hasStock) {
          const stockResult = await configureStock(ctx, url, req, id, form)
          if (!(stockResult as { ok?: boolean }).ok)
            return seeOther(
              inLocale(url, `/admin/products/${id}?invalid=1&count=${errorsOf(stockResult).length}`),
            )
        }
        return seeProduct(id, url)
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
            { ...options, stockEnabled: hasStock, errors: invalidErrors(url, _) },
            await frameFor(ctx, url, req),
            localeSuffix(url),
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
        const name = form.name?.trim()
        if (!name) return seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
        const result = await ctx.call(
          'product.saveAttribute',
          {
            id: randomUUID(),
            name,
            sequence: Number(form.sequence || 10),
            displayType: form.displayType || 'radio',
            createVariant: form.createVariant || 'always',
            active: true,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/product-attributes'))
          : seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('product.listAttributes', {}, url, req)) as Array<Record<string, unknown>>
      return page({
        body: ctx.document({
          lang,
          title: _('product_backend.attributes.title'),
          head: await ctx.styles(req),
          body: attributesScreen(
            _,
            rows,
            await frameFor(ctx, url, req),
            invalidErrors(url, _),
            localeSuffix(url),
          ),
        }),
      })
    },
  '/admin/product-attributes/{id}/values':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const name = form.name?.trim()
      if (!name) return seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
      const result = await ctx.call(
        'product.saveAttributeValue',
        {
          id: randomUUID(),
          attributeId: params.id,
          name,
          sequence: Number(form.sequence || 10),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, '/admin/product-attributes'))
        : seeOther(inLocale(url, '/admin/product-attributes?invalid=1'))
    },
  '/admin/products/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const hasStock = await stockEnabled(ctx, req)
      const activeTab = productTabOf(url)
      let savedPartial = false
      if (req.method === 'POST') {
        const partial = isProductPartial(req)
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
        if (!(result as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(result) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}?invalid=1&count=${errorsOf(result).length}`),
          )
        }
        if (hasStock) {
          const stockResult = await configureStock(ctx, url, req, params.id, form)
          if (!(stockResult as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(stockResult),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(url, `/admin/products/${params.id}?invalid=1&count=${errorsOf(stockResult).length}`),
            )
          }
        }
        if (!partial) return seeProduct(params.id, url)
        savedPartial = true
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
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
      const [mediaRows, variants, options, stockConfig] = await Promise.all([
        mediaFor(ctx, url, req, row.id),
        ctx.call('product.listVariants', { templateId: row.id }, url, req) as Promise<
          Array<{ id: string; defaultCode?: string | null; barcode?: string | null; active?: boolean }>
        >,
        optionsFor(ctx, url, req),
        hasStock
          ? ctx.call('stock.getProductConfig', { templateId: row.id }, url, req)
          : Promise.resolve(null),
      ])
      return page({
        body: ctx.document({
          lang,
          title: row.name,
          head: await ctx.styles(req),
          body: productDetailScreen(
            _,
            { ...row, ...(stockConfig as Record<string, unknown> | null) },
            {
              status: 'ready',
              uploadAction: inLocale(url, `/admin/products/${row.id}/media?tab=media`),
              images: mediaRows.map((image, index) => ({
                id: image.id,
                src: `/files/${image.attachmentId}`,
                alt: image.alt || image.attachment?.name || row.name,
                primary: image.primary,
                actions: {
                  primary: inLocale(url, `/admin/products/${row.id}/media/${image.id}/primary?tab=media`),
                  remove: inLocale(url, `/admin/products/${row.id}/media/${image.id}/remove?tab=media`),
                  ...(index > 0
                    ? {
                        moveUp: inLocale(
                          url,
                          `/admin/products/${row.id}/media/${image.id}/move-up?tab=media`,
                        ),
                      }
                    : {}),
                  ...(index + 1 < mediaRows.length
                    ? {
                        moveDown: inLocale(
                          url,
                          `/admin/products/${row.id}/media/${image.id}/move-down?tab=media`,
                        ),
                      }
                    : {}),
                },
              })),
              extension: await ctx.joint(url, req, 'product_backend:template.media', {
                templateId: row.id,
              }),
            },
            {
              ...options,
              variants,
              stockEnabled: hasStock,
              errors: invalidErrors(url, _),
              editor: await ctx.joint(url, req, 'product_backend:template.editor', {
                templateId: row.id,
                lang,
              }),
            },
            await ctx.joint(url, req, 'product_backend:template.collaboration', {
              resModel: 'product.Template',
              resId: row.id,
              lang,
            }),
            await frameFor(ctx, url, req),
            localeSuffix(url),
            activeTab,
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
        ? seeProduct(params.id, url)
        : seeOther(inLocale(url, `/admin/products/${params.id}?invalid=1`))
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
        ? seeProduct(params.id, url)
        : seeOther(inLocale(url, `/admin/products/${params.id}?invalid=1`))
    },
  '/admin/products/{id}/variants/{variantId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const activeTab = variantTabOf(url)
      const existing = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as Record<
        string,
        unknown
      > | null
      if (!existing || existing.templateId !== params.id) return text('Variant not found', { status: 404 })
      let savedPartial = false
      if (req.method === 'POST') {
        const partial = isProductPartial(req, 'product-variant')
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
        if (!(saved as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(saved) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        const cost = await ctx.call(
          'product.setCost',
          { productId: params.variantId, standardPrice: form.standardPrice || '0' },
          url,
          req,
        )
        if (!(cost as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(cost) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        if (form.uomId) {
          const productUom = await ctx.call(
            'product.addProductUom',
            { productId: params.variantId, uomId: form.uomId, barcode: form.uomBarcode || null },
            url,
            req,
          )
          if (!(productUom as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(productUom),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(url, `/admin/products/${params.id}/variants/${params.variantId}?invalid=1`),
            )
          }
        }
        if (!partial) return seeVariant(params.id, params.variantId, url, activeTab)
        savedPartial = true
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
      const [current, template, options, mediaRows] = await Promise.all([
        ctx.call('product.getVariant', { id: params.variantId }, url, req) as Promise<Record<
          string,
          unknown
        > | null>,
        ctx.call('product.getTemplate', { id: params.id }, url, req) as Promise<{
          id: string
          name: string
        } | null>,
        optionsFor(ctx, url, req),
        variantMediaFor(ctx, url, req, params.variantId),
      ])
      if (!current || current.templateId !== params.id || !template)
        return text('Variant not found', { status: 404 })
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
              uploadAction: inLocale(
                url,
                `/admin/products/${params.id}/variants/${params.variantId}/media?tab=media`,
              ),
              images: mediaRows.map((image, index) => ({
                id: image.id,
                src: `/files/${image.attachmentId}`,
                alt: image.alt || image.attachment?.name || String(current.defaultCode || current.id),
                primary: image.primary,
                actions: {
                  primary: inLocale(
                    url,
                    `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/primary?tab=media`,
                  ),
                  remove: inLocale(
                    url,
                    `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/remove?tab=media`,
                  ),
                  ...(index > 0
                    ? {
                        moveUp: inLocale(
                          url,
                          `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-up?tab=media`,
                        ),
                      }
                    : {}),
                  ...(index + 1 < mediaRows.length
                    ? {
                        moveDown: inLocale(
                          url,
                          `/admin/products/${params.id}/variants/${params.variantId}/media/${image.id}/move-down?tab=media`,
                        ),
                      }
                    : {}),
                },
              })),
              extension: await ctx.joint(url, req, 'product_backend:variant.media', {
                productId: params.variantId,
              }),
            },
            options.uoms,
            template,
            await ctx.joint(url, req, 'product_backend:variant.collaboration', {
              resModel: 'product.Product',
              resId: params.variantId,
              lang,
            }),
            await frameFor(ctx, url, req),
            invalidErrors(url, _),
            localeSuffix(url),
            await ctx.joint(url, req, 'product_backend:variant.editor', {
              productId: params.variantId,
              lang,
            }),
            activeTab,
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
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/products/{id}/variants/{variantId}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
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
      return seeProduct(params.id, url)
    },
  '/admin/products/{id}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/products/{id}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
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
  return seeProduct(templateId, url)
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
  return seeVariant(templateId, productId, url)
}
