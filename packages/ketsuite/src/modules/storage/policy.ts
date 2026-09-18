import { sha256 } from '@ketvietlab/ketjs'

/** Active/unknown content stays behind the application response-header boundary. */
export const inlineTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

/** Per-attachment publication, never the shared private content-addressed key. */
export const publicationKey = (company: string, id: string, checksum: string): string =>
  `published/${company}/${sha256(id)}/${checksum}`

/**
 * The renditions every stored raster image gets, largest edge in pixels. `thumb`
 * is square-cropped for list cells and record thumbnails; the others keep the
 * picture whole. SVG is deliberately absent — it is active content, not pixels.
 */
export const RENDITION_SIZES = {
  thumb: { width: 320, height: 320, fit: 'cover' },
  medium: { width: 960, height: 960, fit: 'inside' },
  large: { width: 1920, height: 1920, fit: 'inside' },
} as const

export type RenditionSize = keyof typeof RENDITION_SIZES

export const renderableTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'])

export const isRenditionSize = (value: unknown): value is RenditionSize =>
  typeof value === 'string' && Object.hasOwn(RENDITION_SIZES, value)

/** Keyed by the source checksum, so a re-render of identical bytes lands on the same object. */
export const renditionKey = (company: string, checksum: string, size: RenditionSize): string =>
  `renditions/${company}/${checksum.slice(0, 2)}/${checksum}/${size}.webp`
