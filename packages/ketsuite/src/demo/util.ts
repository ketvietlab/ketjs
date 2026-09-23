// Shared plumbing for the `--demo-data` seed. Kept separate from the domain
// files so each of those stays pure content plus the handful of calls it makes.

export type Row = Record<string, unknown>
export type Call = (name: string, input: Row) => Promise<Row>

/** ASCII slug for a Vietnamese display name — used for technical fields (email, ref), never for the name itself. */
export const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const MOBILE_PREFIXES = ['090', '091', '093', '096', '097', '098', '032', '035', '070', '079', '081', '086']

/** A distinct-looking Vietnamese mobile number, deterministic from an index. */
export const phoneVN = (index: number): string => {
  const prefix = MOBILE_PREFIXES[index % MOBILE_PREFIXES.length]
  const rest = String(1000000 + ((index * 7919) % 8999999)).padStart(7, '0')
  return `${prefix}${rest}`
}
