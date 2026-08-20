// QR version 2-L, byte mode, one Reed-Solomon block. Attendance badge secrets
// are deliberately 22 ASCII bytes so the complete encoder stays small and has
// no runtime dependency in KetSuite's zero-dependency package.

const multiply = (x: number, y: number): number => {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    if (((y >>> i) & 1) !== 0) z ^= x
  }
  return z
}

const divisor = (degree: number): number[] => {
  const result = Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]!
    }
    root = multiply(root, 2)
  }
  return result
}

const remainder = (data: number[], degree: number): number[] => {
  const result = Array<number>(degree).fill(0)
  const generator = divisor(degree)
  for (const byte of data) {
    const factor = byte ^ result.shift()!
    result.push(0)
    for (let i = 0; i < degree; i++) result[i] ^= multiply(generator[i]!, factor)
  }
  return result
}

const codewords = (text: string): number[] => {
  const bytes = [...new TextEncoder().encode(text)]
  if (bytes.length > 32) throw new Error('QR version 2-L accepts at most 32 byte-mode bytes')
  const bits: number[] = [0, 1, 0, 0]
  for (let i = 7; i >= 0; i--) bits.push((bytes.length >>> i) & 1)
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1)
  for (let i = 0; i < 4 && bits.length < 272; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(Number.parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0; data.length < 34; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11)
  return [...data, ...remainder(data, 10)]
}

export const qrMatrix = (text: string): boolean[][] => {
  const size = 25
  const cells = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const functionCell = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    cells[y]![x] = dark
    functionCell[y]![x] = true
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        set(cx + dx, cy + dy, distance !== 2 && distance !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) set(18 + dx, 18 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)

  // Error correction level L, mask 0. 0x77c4 is the BCH-protected format word.
  const format = 0x77c4
  for (let i = 0; i <= 5; i++) set(8, i, ((format >>> i) & 1) !== 0)
  set(8, 7, ((format >>> 6) & 1) !== 0)
  set(8, 8, ((format >>> 7) & 1) !== 0)
  set(7, 8, ((format >>> 8) & 1) !== 0)
  for (let i = 9; i < 15; i++) set(14 - i, 8, ((format >>> i) & 1) !== 0)
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, ((format >>> i) & 1) !== 0)
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, ((format >>> i) & 1) !== 0)
  set(8, size - 8, true)

  const bits = codewords(text).flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1))
  let index = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx
        if (functionCell[y]![x]) continue
        const bit = bits[index++] ?? 0
        cells[y]![x] = Boolean(bit ^ (((x + y) & 1) === 0 ? 1 : 0))
      }
    }
    upward = !upward
  }
  return cells
}
