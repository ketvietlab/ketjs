import type { StudioContext, SiteTheme, CallOptions } from '../types.ts'
import type { BuilderEntry } from './builder-types.ts'

export const catalogBuilderId = (mode: 'product' | 'template', id: string, productId?: string) =>
  `catalog-${mode}--${id}${mode === 'template' && productId ? `--${productId}` : ''}`

const parse = (id = '') => {
  const [kind, sourceId, productId] = id.split('--')
  if (!['catalog-product', 'catalog-template'].includes(kind) || !sourceId) return null
  return { mode: kind === 'catalog-product' ? 'product' : 'template', id: sourceId, productId }
}

/** Reuse the single standard builder; business documents are never saved as CMS pages. */
export function catalogBuilderContext(ctx: StudioContext): StudioContext {
  let current: (BuilderEntry & { theme?: SiteTheme }) | null = null
  const target = () => parse(ctx.route().params.id)
  return {
    ...ctx,
    uploadImage: (file, options) => {
      const parsed = target()
      return ctx.uploadImage(
        file,
        parsed
          ? {
              ...options,
              id: parsed.id,
              siteId: ctx.site().id,
              resModel: parsed.mode === 'product' ? 'website_catalog.Binding' : 'website_catalog.Template',
            }
          : options,
      )
    },
    tr: (key, params) =>
      ctx.tr(
        target()
          ? ((
              {
                'website.builder.switchPage': 'website.catalog.previewSource',
                'website.route.pages': 'website.route.catalog',
                'website.builder.draftSaved': 'website.catalog.saved',
                'website.workspace.next': 'website.catalog.liveTitle',
              } as Record<string, string>
            )[key] ?? key)
          : key,
        params,
      ),
    href: (key, params, query) =>
      target() && key === 'pages' ? ctx.href('catalog') : ctx.href(key, params, query),
    can: (permission) =>
      target() && ['website.publish', 'website.site.manage'].includes(permission ?? '')
        ? false
        : target() && permission === 'website.content.write'
          ? ctx.can('website.catalog.configure')
          : ctx.can(permission),
    call: async <T>(fn: string, raw: object = {}, options?: CallOptions) => {
      const input = raw as Record<string, unknown>
      const parsed = parse(String(input.id ?? input.entryId ?? ctx.route().params.id))
      if (!target() || !parsed) return ctx.call<T>(fn, input, options)
      const scope = { ...parsed, siteId: ctx.site().id }
      if (fn === 'website.getEntry') {
        current = await ctx.call<BuilderEntry>('website_catalog.getBuilder', scope, options)
        current.entry.id = String(input.id)
        return current as T
      }
      if (fn === 'website.saveEntry')
        return ctx.call<T>('website_catalog.saveBuilder', { ...input, ...scope }, options)
      if (fn === 'website.listEntries') {
        if (input.type !== 'page') return { rows: [] } as T
        const data = await ctx.call<{
          rows: { id: string; productId: string; templateId: string; product: { name: string } }[]
        }>('website_catalog.listBindings', { siteId: ctx.site().id }, options)
        return {
          rows: data.rows
            .filter((b) => parsed.mode !== 'template' || b.templateId === parsed.id)
            .map((b) => ({
              id: catalogBuilderId(
                parsed.mode as 'product' | 'template',
                parsed.mode === 'template' ? parsed.id : b.id,
                b.productId,
              ),
              title: b.product.name,
            })),
        } as T
      }
      if (fn === 'website.diffRevisions') return { changes: [] } as T
      if (fn === 'website_studio.entryHistory')
        return {
          entry: current!.entry,
          revisions: [],
          liveRevisionId: current!.entry.revisionId,
          resources: current!.theme ? [{ ...current!.theme, kind: 'themes' }] : [],
        } as T
      if (fn === 'website_studio.createPreview') return { token: 'staff-catalog' } as T
      if (fn === 'website_studio.preview') {
        const query = new URLSearchParams({
          site: ctx.site().id,
          ...(parsed.productId ? { product: parsed.productId } : {}),
        })
        return {
          preview: {
            url: `/website/catalog/preview/${parsed.mode}/${encodeURIComponent(parsed.id)}?${query}`,
          },
        } as T
      }
      if (fn === 'website_studio.listResources' && input.kind === 'templates') return { rows: [] } as T
      if (['website_studio.savePageSettings', 'website_studio.restoreEntry'].includes(fn)) {
        throw new Error(ctx.tr('website.catalog.builderUnsupported'))
      }
      return ctx.call<T>(fn, input, options)
    },
  }
}
