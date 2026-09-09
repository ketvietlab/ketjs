/** The original custom-element island host. Kept as the default for compatibility. */
export const ISLAND_TAG = 'ket-island'

/** Marks a standard HTML element as an island host. */
export const ISLAND_HOST_ATTRIBUTE = 'data-ket-island'

/** Finds both legacy custom-element hosts and standard-element hosts. */
export const ISLAND_SELECTOR = `${ISLAND_TAG},div[${ISLAND_HOST_ATTRIBUTE}]`

export type IslandHostTag = typeof ISLAND_TAG | 'div'
