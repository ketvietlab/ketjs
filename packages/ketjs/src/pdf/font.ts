type Table = { offset: number; length: number }

const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o)
const i16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt16(o)
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o)

export type TrueTypeFont = {
  bytes: Uint8Array
  unitsPerEm: number
  ascent: number
  descent: number
  glyphOf(point: number): number
  widthOf(glyph: number): number
}

export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const tables: Record<string, Table> = {}
  const count = u16(bytes, 4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(...bytes.slice(at, at + 4))
    tables[tag] = { offset: u32(bytes, at + 8), length: u32(bytes, at + 12) }
  }
  for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'cmap'])
    if (!tables[tag]) throw new Error(`font misses ${tag}`)
  const head = tables.head!.offset
  const hhea = tables.hhea!.offset
  const hmtx = tables.hmtx!.offset
  const numGlyphs = u16(bytes, tables.maxp!.offset + 4)
  const metrics = u16(bytes, hhea + 34)
  const widths: number[] = []
  for (let glyph = 0; glyph < numGlyphs; glyph++)
    widths.push(u16(bytes, hmtx + Math.min(glyph, metrics - 1) * 4))

  const cmap = tables.cmap!.offset
  const subtables = u16(bytes, cmap + 2)
  let chosen = 0
  for (let i = 0; i < subtables; i++) {
    const at = cmap + 4 + i * 8
    const platform = u16(bytes, at)
    const encoding = u16(bytes, at + 2)
    const offset = cmap + u32(bytes, at + 4)
    const format = u16(bytes, offset)
    if (platform === 3 && ((encoding === 10 && format === 12) || (!chosen && encoding === 1 && format === 4)))
      chosen = offset
  }
  if (!chosen) throw new Error('font has no Unicode cmap')
  const format = u16(bytes, chosen)
  const glyphOf =
    format === 12
      ? (point: number) => {
          const groups = u32(bytes, chosen + 12)
          for (let i = 0; i < groups; i++) {
            const at = chosen + 16 + i * 12
            const start = u32(bytes, at)
            const end = u32(bytes, at + 4)
            if (point >= start && point <= end) return u32(bytes, at + 8) + point - start
          }
          return 0
        }
      : (point: number) => {
          if (point > 0xffff) return 0
          const segCount = u16(bytes, chosen + 6) / 2
          const endCodes = chosen + 14
          const startCodes = endCodes + segCount * 2 + 2
          const deltas = startCodes + segCount * 2
          const ranges = deltas + segCount * 2
          for (let i = 0; i < segCount; i++) {
            const end = u16(bytes, endCodes + i * 2)
            if (point > end) continue
            const start = u16(bytes, startCodes + i * 2)
            if (point < start) return 0
            const delta = i16(bytes, deltas + i * 2)
            const range = u16(bytes, ranges + i * 2)
            if (!range) return (point + delta) & 0xffff
            const glyph = u16(bytes, ranges + i * 2 + range + (point - start) * 2)
            return glyph ? (glyph + delta) & 0xffff : 0
          }
          return 0
        }
  return {
    bytes,
    unitsPerEm: u16(bytes, head + 18),
    ascent: i16(bytes, hhea + 4),
    descent: i16(bytes, hhea + 6),
    glyphOf,
    widthOf: (glyph) => widths[glyph] ?? widths[0] ?? 0,
  }
}
