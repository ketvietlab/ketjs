/** Read a complete authorized array through an existing cursor-based list API.
 * The short final batch, rather than an arbitrary overall limit, ends the read.
 * Keeping the existing function preserves grants held by custom CRM roles.
 */
export const completeCollectionRows = async <R>(
  read: (cursor: number, limit: number) => Promise<R[]>,
): Promise<R[]> => {
  const rows: R[] = []
  const limit = 200
  for (;;) {
    const batch = await read(rows.length, limit)
    rows.push(...batch)
    if (batch.length < limit) return rows
  }
}
