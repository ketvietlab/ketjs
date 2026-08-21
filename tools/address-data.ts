// Build a deterministic KetSuite address catalog from the JSON maintained by
// Vidoo Vietnam Address Core data. This is a development tool only: the
// resulting bundle ships with KetSuite and production never reads another repo
// or fetches a remote URL.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

type Province = { id: string; name: string }
type Ward = { id: string; name: string; provinceId: string }
type Division = {
  code: string
  parentCode: string | null
  level: number
  kind: string
  officialName: string
  shortName: string
}

const args = process.argv.slice(2)
const argumentValue = (name: string): string => {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : null
  if (!value) throw new Error(`missing ${name}`)
  return resolve(value)
}

const source = argumentValue('--source')
const output = argumentValue('--output')
const chunkSize = Number(args[args.indexOf('--chunk-size') + 1] ?? 1000)
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 10_000)
  throw new Error('--chunk-size must be an integer from 1 to 10000')

const parse = async <T>(path: string): Promise<{ value: T; bytes: Buffer; sha256: string }> => {
  const bytes = await readFile(path)
  return {
    value: JSON.parse(bytes.toString('utf8')) as T,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
const stable = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const short = (name: string): string =>
  name.replace(/^(?:Tp\s+|Tỉnh\s+|Thành phố\s+|Phường\s+|Xã\s+|Đặc khu\s+)/i, '')
const wardKind = (name: string): string => {
  if (name.startsWith('Phường ')) return 'ward'
  if (name.startsWith('Xã ')) return 'commune'
  if (name.startsWith('Đặc khu ')) return 'special_zone'
  throw new Error(`unknown Vietnam division kind: ${name}`)
}
const municipality = new Set(['01', '04', '20', '21', '29', '33'])

const provincesPath = join(source, 'provinces.json')
const wardsPath = join(source, 'wards.json')
const provinces = await parse<Province[]>(provincesPath)
const wards = await parse<Ward[]>(wardsPath)
if (provinces.value.length !== 34) throw new Error(`expected 34 provinces, got ${provinces.value.length}`)
if (wards.value.length !== 3321) throw new Error(`expected 3321 wards, got ${wards.value.length}`)

const provinceCodes = new Set(provinces.value.map((row) => row.id))
if (provinceCodes.size !== provinces.value.length) throw new Error('duplicate province code')
const wardCodes = new Set(wards.value.map((row) => row.id))
if (wardCodes.size !== wards.value.length) throw new Error('duplicate ward code')
for (const ward of wards.value)
  if (!provinceCodes.has(ward.provinceId))
    throw new Error(`${ward.id} has unknown province ${ward.provinceId}`)

const divisions: Division[] = [
  ...provinces.value.map((row) => ({
    code: row.id,
    parentCode: null,
    level: 1,
    kind: municipality.has(row.id) ? 'municipality' : 'province',
    officialName: municipality.has(row.id) ? row.name.replace(/^Tp\s+/i, 'Thành phố ') : `Tỉnh ${row.name}`,
    shortName: short(row.name),
  })),
  ...wards.value.map((row) => ({
    code: row.id,
    parentCode: row.provinceId,
    level: 2,
    kind: wardKind(row.name),
    officialName: row.name,
    shortName: short(row.name),
  })),
].sort(
  (a, b) =>
    a.level - b.level ||
    (a.parentCode ?? '').localeCompare(b.parentCode ?? '') ||
    a.code.localeCompare(b.code),
)

await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'divisions'), { recursive: true })

const chunks: Array<{ path: string; count: number; sha256: string }> = []
for (let offset = 0; offset < divisions.length; offset += chunkSize) {
  const name = `${String(chunks.length + 1).padStart(4, '0')}.json`
  const relative = `divisions/${name}`
  const contents = stable(divisions.slice(offset, offset + chunkSize))
  await writeFile(join(output, relative), contents)
  chunks.push({
    path: relative,
    count: Math.min(chunkSize, divisions.length - offset),
    sha256: digest(contents),
  })
}

const counts = divisions.reduce<Record<string, number>>((out, row) => {
  out[row.kind] = (out[row.kind] ?? 0) + 1
  return out
}, {})
const policy = {
  schemaVersion: 1,
  countryCode: 'VN',
  postalCode: { required: false, pattern: '^[0-9]{5,6}$' },
  divisionLevels: [
    {
      level: 1,
      labelKey: 'address.level.province',
      allowedKinds: ['province', 'municipality'],
      required: true,
    },
    {
      level: 2,
      labelKey: 'address.level.commune',
      allowedKinds: ['commune', 'ward', 'special_zone'],
      required: true,
    },
  ],
  format: { lines: [['street1'], ['street2'], ['division:2', 'division:1'], ['postalCode'], ['country']] },
}
const policyText = stable(policy)
await writeFile(join(output, 'policy.json'), policyText)

const manifest = {
  schemaVersion: 1,
  country: {
    code: 'VN',
    alpha3: 'VNM',
    numericCode: '704',
    name: 'Vietnam',
    officialName: 'Socialist Republic of Vietnam',
    localName: 'Việt Nam',
    callingCode: '84',
  },
  recommendedCatalog: '2025-07-01',
  catalogs: [
    {
      version: '2025-07-01',
      codeSystem: 'VIDOO_VN_ADDRESS_2025',
      authority: 'Vidoo Vietnam Address Core',
      legalBasis: '19/2025/QĐ-TTg',
      effectiveFrom: '2025-07-01',
      sourceUrl: 'https://vanban.chinhphu.vn/?docid=214409&pageid=27160',
      sourceAttribution: {
        name: 'Vidoo Vietnam Address Core',
        author: 'vidoo.dev',
        website: 'https://vidoo.dev',
        license: 'LGPL-3.0',
      },
      sourceFiles: [
        { name: basename(provincesPath), sha256: provinces.sha256, count: provinces.value.length },
        { name: basename(wardsPath), sha256: wards.sha256, count: wards.value.length },
      ],
      policy: { path: 'policy.json', sha256: digest(policyText) },
      divisions: { totalCount: divisions.length, counts, chunks },
    },
  ],
}
await writeFile(join(output, 'manifest.json'), stable(manifest))
console.log(
  `generated VN ${manifest.catalogs[0].version}: ${divisions.length} divisions in ${chunks.length} chunks`,
)
