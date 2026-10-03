// The bundled Core presets. `default` is the plain storefront; every other one is drawn by skin.css
// plus its own file, one per trade the deployments serve: cosmetics (cosmetic), retail (commerce),
// restaurant (fnb), hotel (hospitality) and services (office). Any site may pick any of them.
// The host keeps the same list in website/studio-style.ts.
export const themePresets = ['default', 'cosmetics', 'retail', 'restaurant', 'hotel', 'services'] as const

/** A preset with its own skin: the visitor frame collapses the search and lets a leading hero own the h1. */
export const skinnedPreset = (preset: unknown): boolean =>
  typeof preset === 'string' && preset !== 'default' && (themePresets as readonly string[]).includes(preset)

/** The picture on the theme's card in the Studio. */
export const presetCover = (preset: unknown): string =>
  preset === 'cosmetics'
    ? '/website-client/theme/cosmetics/collection.svg'
    : skinnedPreset(preset)
      ? `/website-client/theme/${preset}.svg`
      : '/website-client/theme/garden.svg'
