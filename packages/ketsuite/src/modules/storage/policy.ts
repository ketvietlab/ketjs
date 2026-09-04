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
