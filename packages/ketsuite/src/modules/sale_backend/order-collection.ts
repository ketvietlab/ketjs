/**
 * The order API bounds each request. Lists search the displayed customer name
 * after resolving partners, so they need every authorised order before that
 * search and the shared collection pager run. Keep the dashboard's bounded
 * recent-orders query separate from this complete collection reader.
 */
const ORDER_BATCH_SIZE = 500

export const loadSaleOrderCollection = async <R>(
  load: (page: { limit: number; offset: number }) => Promise<R[]>,
): Promise<R[]> => {
  const rows: R[] = []
  for (;;) {
    const batch = await load({ limit: ORDER_BATCH_SIZE, offset: rows.length })
    rows.push(...batch)
    if (batch.length < ORDER_BATCH_SIZE) return rows
  }
}

/** The partner API accepts at most 2,000 explicit IDs in a lookup. */
export const loadSalePartnerNames = async (
  ids: readonly string[],
  load: (ids: string[]) => Promise<Record<string, unknown>[]>,
): Promise<Map<string, unknown>> => {
  const names = new Map<string, unknown>()
  for (let offset = 0; offset < ids.length; offset += 2000) {
    const partners = await load(ids.slice(offset, offset + 2000))
    for (const partner of partners) names.set(String(partner.id), partner.name)
  }
  return names
}
