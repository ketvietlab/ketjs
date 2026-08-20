import { eq, from } from 'ketjs'
import type { Ctx, Row } from 'ketjs'

export type AddressInput = {
  street1?: unknown
  street2?: unknown
  locality?: unknown
  postalCode?: unknown
  countryId?: unknown
  divisionId?: unknown
}
export type AddressIssue = { field: string; code: string; params?: Record<string, unknown> }
export type ResolvedAddress = {
  country: Row
  divisions: Row[]
  lines: string[]
  oneLine: string
}

const text = (value: unknown): string => String(value ?? '').trim()
const policyOf = (
  country: Row,
): {
  postalCode?: { required?: boolean; pattern?: string }
  divisionLevels?: Array<{ level: number; required?: boolean; allowedKinds?: string[] }>
  format?: { lines?: string[][] }
} => (country.policy && typeof country.policy === 'object' ? country.policy : {}) as never

export const divisionPath = async (ctx: Ctx, divisionId: string): Promise<Row[]> => {
  const D = ctx.table('address.Division')
  const out: Row[] = []
  const seen = new Set<string>()
  let id: string | null = divisionId
  while (id) {
    if (seen.has(id) || seen.size >= 16) throw new Error('address division hierarchy contains a cycle')
    seen.add(id)
    const row = await ctx.db.one(from(D).where(eq(D.id, id)))
    if (!row) break
    out.push(row)
    id = row.parentId ? String(row.parentId) : null
  }
  return out.reverse()
}

export const validateAddress = async (
  ctx: Ctx,
  input: AddressInput,
): Promise<{ issues: AddressIssue[]; country: Row | null; divisions: Row[] }> => {
  const issues: AddressIssue[] = []
  const countryId = text(input.countryId).toUpperCase()
  const C = ctx.table('address.Country')
  const country = countryId ? await ctx.db.one(from(C).where(eq(C.id, countryId), eq(C.active, true))) : null
  if (!country) {
    issues.push({
      field: 'countryId',
      code: countryId ? 'address.error.countryCode' : 'address.error.required',
    })
    return { issues, country: null, divisions: [] }
  }
  const policy = policyOf(country)
  const postalCode = text(input.postalCode)
  if (policy.postalCode?.required && !postalCode)
    issues.push({ field: 'postalCode', code: 'address.error.required' })
  if (postalCode && policy.postalCode?.pattern) {
    let matches = false
    try {
      matches = new RegExp(policy.postalCode.pattern).test(postalCode)
    } catch {
      matches = false
    }
    if (!matches) issues.push({ field: 'postalCode', code: 'address.error.postalCode' })
  }

  const current = await ctx.db.one(
    from(ctx.table('address.CurrentCatalog')).where(
      eq(ctx.table('address.CurrentCatalog').countryId, country.id),
    ),
  )
  const divisionId = text(input.divisionId)
  let divisions: Row[] = []
  if (divisionId) {
    divisions = await divisionPath(ctx, divisionId)
    const selected = divisions.at(-1)
    if (!selected || selected.countryId !== country.id)
      issues.push({ field: 'divisionId', code: 'address.error.countryMismatch' })
    else if (!current || selected.catalogId !== current.catalogId)
      issues.push({ field: 'divisionId', code: 'address.error.divisionRetired' })
    else {
      const byLevel = new Map(divisions.map((row) => [Number(row.level), row]))
      for (const level of policy.divisionLevels ?? []) {
        const row = byLevel.get(level.level)
        if (level.required && !row) {
          issues.push({
            field: 'divisionId',
            code: 'address.error.requiredLevel',
            params: { level: level.level },
          })
          continue
        }
        if (row && level.allowedKinds?.length && !level.allowedKinds.includes(String(row.kind)))
          issues.push({
            field: 'divisionId',
            code: 'address.error.divisionKind',
            params: { level: level.level, allowed: level.allowedKinds },
          })
      }
    }
  } else if (current && policy.divisionLevels?.some((level) => level.required)) {
    issues.push({ field: 'divisionId', code: 'address.error.required' })
  }
  return { issues, country, divisions }
}

export const resolveAddress = async (
  ctx: Ctx,
  input: AddressInput,
): Promise<{ issues: AddressIssue[]; value?: ResolvedAddress }> => {
  const checked = await validateAddress(ctx, input)
  if (!checked.country || checked.issues.length) return { issues: checked.issues }
  const country = checked.country
  const policy = policyOf(country)
  const byLevel = new Map(checked.divisions.map((row) => [Number(row.level), text(row.officialName)]))
  const token = (name: string): string => {
    if (name === 'street1') return text(input.street1)
    if (name === 'street2') return text(input.street2)
    if (name === 'locality') return text(input.locality)
    if (name === 'postalCode') return text(input.postalCode)
    if (name === 'country') return text(country.localName || country.name)
    if (name.startsWith('division:')) return byLevel.get(Number(name.slice('division:'.length))) ?? ''
    return ''
  }
  const format = policy.format?.lines ?? [['street1'], ['street2'], ['locality'], ['postalCode'], ['country']]
  const lines = format.map((line) => line.map(token).filter(Boolean).join(', ')).filter(Boolean)
  return {
    issues: [],
    value: { country, divisions: checked.divisions, lines, oneLine: lines.join(', ') },
  }
}

export const snapshotAddress = async (
  ctx: Ctx,
  input: AddressInput & { id?: unknown },
  capturedAt = new Date().toISOString(),
): Promise<{ issues: AddressIssue[]; snapshot?: Record<string, unknown> }> => {
  const resolved = await resolveAddress(ctx, input)
  if (!resolved.value) return { issues: resolved.issues }
  const current = await ctx.db.one(
    from(ctx.table('address.CurrentCatalog')).where(
      eq(ctx.table('address.CurrentCatalog').countryId, resolved.value.country.id),
    ),
  )
  return {
    issues: [],
    snapshot: {
      schemaVersion: 1,
      sourceAddressId: input.id ? String(input.id) : null,
      capturedAt,
      catalogId: current?.catalogId ?? null,
      country: {
        id: resolved.value.country.id,
        code: resolved.value.country.code,
        name: resolved.value.country.localName || resolved.value.country.name,
      },
      divisions: resolved.value.divisions.map((row) => ({
        id: row.id,
        code: row.code,
        level: row.level,
        kind: row.kind,
        name: row.officialName,
      })),
      street1: text(input.street1),
      street2: text(input.street2) || null,
      locality: text(input.locality) || null,
      postalCode: text(input.postalCode) || null,
      lines: resolved.value.lines,
      oneLine: resolved.value.oneLine,
    },
  }
}
