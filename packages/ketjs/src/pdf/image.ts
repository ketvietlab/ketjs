import { deflateSync, inflateSync } from 'node:zlib'

export type PdfImage = {
  width: number
  height: number
  bytes: Uint8Array
  filter: '/DCTDecode' | '/FlateDecode'
}

const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at)
const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function png(bytes: Uint8Array): PdfImage {
  const width = u32(bytes, 16)
  const height = u32(bytes, 20)
  const depth = bytes[24]
  const color = bytes[25]
  const interlace = bytes[28]
  if (depth !== 8 || ![2, 6].includes(color) || interlace !== 0)
    throw new Error('PNG images must be non-interlaced 8-bit RGB or RGBA')
  const parts: Uint8Array[] = []
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = u32(bytes, at)
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8))
    if (type === 'IDAT') parts.push(bytes.slice(at + 8, at + 8 + length))
    at += length + 12
  }
  const packed = inflateSync(concat(parts))
  const channels = color === 6 ? 4 : 3
  const stride = width * channels
  const raw = new Uint8Array(height * stride)
  let input = 0
  for (let y = 0; y < height; y++) {
    const filter = packed[input++] as number
    for (let x = 0; x < stride; x++) {
      const value = packed[input++] as number
      const left = x >= channels ? raw[y * stride + x - channels]! : 0
      const above = y ? raw[(y - 1) * stride + x]! : 0
      const upperLeft = y && x >= channels ? raw[(y - 1) * stride + x - channels]! : 0
      raw[y * stride + x] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 255
            : filter === 2
              ? (value + above) & 255
              : filter === 3
                ? (value + Math.floor((left + above) / 2)) & 255
                : filter === 4
                  ? (value + paeth(left, above, upperLeft)) & 255
                  : 0
    }
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let from = 0, to = 0; from < raw.length; from += channels, to += 3) {
    const alpha = channels === 4 ? raw[from + 3]! / 255 : 1
    rgb[to] = Math.round(raw[from]! * alpha + 255 * (1 - alpha))
    rgb[to + 1] = Math.round(raw[from + 1]! * alpha + 255 * (1 - alpha))
    rgb[to + 2] = Math.round(raw[from + 2]! * alpha + 255 * (1 - alpha))
  }
  return { width, height, bytes: deflateSync(rgb), filter: '/FlateDecode' }
}

function jpeg(bytes: Uint8Array): PdfImage {
  for (let at = 2; at + 9 < bytes.length; ) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1] as number
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!
      return { width, height, bytes, filter: '/DCTDecode' }
    }
    at += 2 + length
  }
  throw new Error('JPEG dimensions are missing')
}

export function parseImage(bytes: Uint8Array): PdfImage {
  if (bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') return png(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes)
  throw new Error('report images must be PNG or JPEG')
}
