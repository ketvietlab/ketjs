import type { Route, ServeContext } from '@ketvietlab/ketjs'

/** These readers return bounded metadata pages and enforce their own site access. */
type WebsiteCollectionReader =
  | 'website.listRevisions'
  | 'website.listTaxonomyTerms'
  | 'website.listMedia'
  | 'website.listRedirects'
  | 'website.listPublications'

/**
 * Existing Website screens need the complete metadata collection for native
 * search, revision comparison choices and editing records outside the visible
 * page. Read every bounded API page before the shared table paginates it. The
 * batch size bounds each read; it is never presented as the collection total.
 */
export const readWebsiteCollection = async <R>(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  reader: WebsiteCollectionReader,
  filter: Record<string, unknown>,
): Promise<R[]> => {
  const rows: R[] = []
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const batch = (await ctx.call(reader, { ...filter, limit, offset }, url, req)) as R[]
    rows.push(...batch)
    if (batch.length < limit) return rows
  }
}
