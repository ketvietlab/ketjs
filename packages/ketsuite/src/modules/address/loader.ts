import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export type CountryBundle = {
  code: string
  alpha3?: string
  numericCode?: string
  name: string
  officialName?: string
  localName?: string
  callingCode?: string
}

export type DivisionBundle = {
  code: string
  parentCode: string | null
  level: number
  kind: string
  officialName: string
  shortName?: string
}

export type AddressPolicy = {
  schemaVersion: number
  countryCode: string
  postalCode: { required: boolean; pattern?: string }
  divisionLevels: Array<{
    level: number
    labelKey: string
    allowedKinds: string[]
    required: boolean
  }>
  format: { lines: string[][] }
}

type Chunk = { path: string; count: number; sha256: string }
type CatalogBundle = {
  version: string
  codeSystem: string
  authority: string
  legalBasis?: string
  effectiveFrom: string
  sourceUrl?: string
  sourceAttribution?: unknown
  sourceFiles?: unknown[]
  policy: { path: string; sha256: string }
  divisions: { totalCount: number; counts: Record<string, number>; chunks: Chunk[] }
}
type ManifestBundle = {
  schemaVersion: number
  country: CountryBundle
  recommendedCatalog: string
  catalogs: CatalogBundle[]
}
type IndexBundle = {
  schemaVersion: number
  countries: Record<
    string,
    {
      recommendedCatalog: string
      catalogs: Record<string, { manifest: string; sha256: string }>
    }
  >
}

export type LoadedCatalog = {
  country: CountryBundle
  catalog: CatalogBundle
  policy: AddressPolicy
  divisions: DivisionBundle[]
  checksum: string
}

const DATA = new URL('./data/', import.meta.url)
const ISO = /^[A-Z]{2}$/
const VERSION = /^\d{4}-\d{2}-\d{2}$/
const SHA256 = /^[a-f0-9]{64}$/
const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const safeRelative = (value: string): boolean =>
  !!value && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..')

let indexPromise: Promise<IndexBundle> | null = null
const readIndex = (data: URL): Promise<IndexBundle> =>
  readFile(new URL('index.json', data)).then((bytes) => {
    const parsed = JSON.parse(bytes.toString('utf8')) as IndexBundle
    if (parsed.schemaVersion !== 1 || !parsed.countries || typeof parsed.countries !== 'object')
      throw new Error('address data index has an unsupported schema')
    return parsed
  })
const indexOf = (): Promise<IndexBundle> => {
  indexPromise ??= readIndex(DATA)
  return indexPromise
}

const readVerified = async (url: URL, expected: string): Promise<Buffer> => {
  if (!SHA256.test(expected)) throw new Error(`invalid SHA-256 for ${url.pathname}`)
  const bytes = await readFile(url)
  if (digest(bytes) !== expected) throw new Error(`checksum mismatch for ${url.pathname}`)
  return bytes
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const validateDivision = (value: unknown, index: number): DivisionBundle => {
  const row = object(value, `division ${index}`)
  const known = new Set(['code', 'parentCode', 'level', 'kind', 'officialName', 'shortName'])
  const unknown = Object.keys(row).filter((key) => !known.has(key))
  if (unknown.length) throw new Error(`division ${index} has unknown fields: ${unknown.join(', ')}`)
  if (typeof row.code !== 'string' || !row.code) throw new Error(`division ${index} has no code`)
  if (row.parentCode !== null && typeof row.parentCode !== 'string')
    throw new Error(`division ${row.code} has an invalid parentCode`)
  if (!Number.isInteger(row.level) || Number(row.level) < 1 || Number(row.level) > 16)
    throw new Error(`division ${row.code} has an invalid level`)
  for (const field of ['kind', 'officialName'] as const)
    if (typeof row[field] !== 'string' || !String(row[field]).trim())
      throw new Error(`division ${row.code} has an invalid ${field}`)
  if (row.shortName != null && typeof row.shortName !== 'string')
    throw new Error(`division ${row.code} has an invalid shortName`)
  return row as DivisionBundle
}

const validateTree = (rows: DivisionBundle[], expectedCount: number): void => {
  if (rows.length !== expectedCount)
    throw new Error(`expected ${expectedCount} divisions, got ${rows.length}`)
  const byCode = new Map<string, DivisionBundle>()
  for (const row of rows) {
    if (byCode.has(row.code)) throw new Error(`duplicate division code ${row.code}`)
    byCode.set(row.code, row)
  }
  for (const row of rows) {
    if (row.parentCode === null) {
      if (row.level !== 1) throw new Error(`root division ${row.code} must be level 1`)
      continue
    }
    const parent = byCode.get(row.parentCode)
    if (!parent) throw new Error(`division ${row.code} has unknown parent ${row.parentCode}`)
    if (parent.level + 1 !== row.level) throw new Error(`division ${row.code} skips an administrative level`)
    const seen = new Set([row.code])
    let cursor: DivisionBundle | undefined = parent
    for (let depth = 0; cursor; depth++) {
      if (depth >= 16 || seen.has(cursor.code)) throw new Error(`division ${row.code} has a cycle`)
      seen.add(cursor.code)
      cursor = cursor.parentCode ? byCode.get(cursor.parentCode) : undefined
    }
  }
}

export const availableCatalogs = async (): Promise<
  Array<{ countryCode: string; version: string; recommended: boolean }>
> => {
  const index = await indexOf()
  return Object.entries(index.countries)
    .flatMap(([countryCode, entry]) =>
      Object.keys(entry.catalogs).map((version) => ({
        countryCode,
        version,
        recommended: version === entry.recommendedCatalog,
      })),
    )
    .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.version.localeCompare(b.version))
}

export const loadCatalogFrom = async (
  data: URL,
  countryInput: string,
  versionInput?: string,
): Promise<LoadedCatalog> => {
  const countryCode = countryInput.trim().toUpperCase()
  if (!ISO.test(countryCode)) throw new Error('countryCode must be ISO 3166-1 alpha-2')
  const index = data.href === DATA.href ? await indexOf() : await readIndex(data)
  const country = index.countries[countryCode]
  if (!country) throw new Error(`no bundled address catalog for ${countryCode}`)
  const version = versionInput ?? country.recommendedCatalog
  if (!VERSION.test(version)) throw new Error('catalog version must be YYYY-MM-DD')
  const entry = country.catalogs[version]
  if (!entry || !safeRelative(entry.manifest) || !entry.manifest.startsWith(`${countryCode}/`))
    throw new Error(`no bundled address catalog for ${countryCode} ${version}`)
  const manifestUrl = new URL(entry.manifest, data)
  const manifestBytes = await readVerified(manifestUrl, entry.sha256)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as ManifestBundle
  if (
    manifest.schemaVersion !== 1 ||
    manifest.country?.code !== countryCode ||
    manifest.recommendedCatalog !== country.recommendedCatalog
  )
    throw new Error('address manifest does not match its index entry')
  const catalog = manifest.catalogs.find((item) => item.version === version)
  if (!catalog) throw new Error(`manifest has no catalog ${version}`)
  if (!safeRelative(catalog.policy.path)) throw new Error('address policy path is unsafe')
  const policyUrl = new URL(catalog.policy.path, manifestUrl)
  const policyBytes = await readVerified(policyUrl, catalog.policy.sha256)
  const policy = JSON.parse(policyBytes.toString('utf8')) as AddressPolicy
  if (policy.schemaVersion !== 1 || policy.countryCode !== countryCode)
    throw new Error('address policy does not match its country')

  const divisions: DivisionBundle[] = []
  for (const chunk of catalog.divisions.chunks) {
    if (!safeRelative(chunk.path)) throw new Error('address division path is unsafe')
    const bytes = await readVerified(new URL(chunk.path, manifestUrl), chunk.sha256)
    const raw = JSON.parse(bytes.toString('utf8')) as unknown
    if (!Array.isArray(raw) || raw.length !== chunk.count)
      throw new Error(`address division chunk ${chunk.path} has the wrong count`)
    for (const value of raw) divisions.push(validateDivision(value, divisions.length))
  }
  validateTree(divisions, catalog.divisions.totalCount)
  const actualCounts = divisions.reduce<Record<string, number>>((out, row) => {
    out[row.kind] = (out[row.kind] ?? 0) + 1
    return out
  }, {})
  if (JSON.stringify(actualCounts) !== JSON.stringify(catalog.divisions.counts))
    throw new Error('address division kind counts do not match the manifest')
  return { country: manifest.country, catalog, policy, divisions, checksum: entry.sha256 }
}

export const loadCatalog = (countryInput: string, versionInput?: string): Promise<LoadedCatalog> =>
  loadCatalogFrom(DATA, countryInput, versionInput)
