/**
 * What a location is for — Odoo's `usage`, and the reason its stock model works.
 *
 * Every movement goes from a location to a location, including the ones that leave
 * the building: receiving is supplier → internal, delivering is internal → customer.
 * Nothing is created or destroyed, only moved, so the books balance by construction
 * and "where did those twelve go" always has an answer.
 *
 * The virtual usages hold negative quantities, and that is correct rather than a
 * bug: a supplier location at −40 says forty units came in from outside.
 */
export const LOCATION_USAGES = [
  /** A folder in the tree. Holds nothing itself. */
  'view',
  /** Real stock you own and count. Only these sum to "what we have". */
  'internal',
  /** Outside, upstream. Goods arrive from here. */
  'supplier',
  /** Outside, downstream. Goods leave to here. */
  'customer',
  /** The counterpart of a stock-take adjustment. */
  'inventory',
  /** Consumed by, or produced from, manufacturing. */
  'production',
  /** In between two of your own warehouses. */
  'transit',
] as const
export type LocationUsage = (typeof LOCATION_USAGES)[number]

/** Usages whose quantity counts as stock on hand. */
export const REAL_USAGES: readonly LocationUsage[] = ['internal', 'transit']

/**
 * A move's life. Odoo has more; these are the ones that change what a quant says.
 *
 *   draft     written down, reserving nothing
 *   assigned  stock is set aside for it — someone else can no longer promise it
 *   done      applied: quantities actually moved
 *   cancel    abandoned, and anything it reserved was given back
 */
export const MOVE_STATES = ['draft', 'assigned', 'done', 'cancel'] as const
export type MoveState = (typeof MOVE_STATES)[number]
