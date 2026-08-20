import type { ReportDocument, ReportElement, ReportNode } from './markup.ts'
import { parseTrueType } from './font.ts'
import { parseImage } from './image.ts'

export type PdfRenderOptions = {
  /** Inter Regular, retained as the fallback for backwards compatibility. */
  font: Uint8Array
  /** Inter SemiBold used by table headings and `weight="semibold"`. */
  semiboldFont?: Uint8Array
  /** Inter Bold used by `weight="bold"`. */
  boldFont?: Uint8Array
  /** Attachment bytes keyed by the `<image src="...">` identifier. */
  images?: Record<string, Uint8Array>
  maxPages?: number
}

type FontWeight = 'regular' | 'semibold' | 'bold'
type Tone = 'ink' | 'muted' | 'accent'
type Cell = {
  text: string
  size: number
  align: 'left' | 'center' | 'right'
  weight: FontWeight
  tone: Tone
}

type Line = {
  text: string
  size: number
  align: 'left' | 'center' | 'right'
  weight: FontWeight
  tone: Tone
  gap: number
  rule?: boolean
  cells?: Cell[]
  repeat?: boolean
  image?: string
  imageWidth?: number
  imageHeight?: number
}
type Block = Line | { pageBreak: true }
const textOf = (node: ReportNode): string =>
  node.kind === 'text' ? node.value : node.children.map(textOf).join('')
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const weightOf = (value: string | undefined, fallback: FontWeight = 'regular'): FontWeight =>
  value === 'bold' || value === '700'
    ? 'bold'
    : value === 'semibold' || value === '600'
      ? 'semibold'
      : fallback
const toneOf = (value: string | undefined, fallback: Tone = 'ink'): Tone =>
  value === 'muted' || value === 'accent' ? value : fallback
const alignOf = (value: string | undefined, fallback: Cell['align'] = 'left'): Cell['align'] =>
  value === 'center' || value === 'right' ? value : fallback

function blocksOf(root: ReportElement): { body: Block[]; header: Line[]; footer: Line[] } {
  const body: Block[] = []
  const header: Line[] = []
  const footer: Line[] = []
  const walk = (node: ReportNode, out: Block[], repeat = false) => {
    if (node.kind === 'text') {
      if (node.value.trim())
        out.push({
          text: node.value.trim(),
          size: 10,
          align: 'left',
          weight: 'regular',
          tone: 'ink',
          gap: 4,
        })
      return
    }
    if (node.tag === 'page-break') {
      out.push({ pageBreak: true })
      return
    }
    if (node.tag === 'text') {
      out.push({
        text: textOf(node).trim(),
        size: number(node.attrs.size, 10),
        align: alignOf(node.attrs.align),
        weight: weightOf(node.attrs.weight),
        tone: toneOf(node.attrs.tone),
        gap: number(node.attrs.gap, 4),
      })
      return
    }
    if (node.tag === 'image') {
      out.push({
        text: '',
        image: node.attrs.src ?? '',
        imageWidth: number(node.attrs.width, 96),
        imageHeight: number(node.attrs.height, 48),
        size: 0,
        align: alignOf(node.attrs.align),
        weight: 'regular',
        tone: 'ink',
        gap: number(node.attrs.gap, 8),
      })
      return
    }
    if (node.tag === 'row') {
      const children = node.children.filter(
        (child): child is ReportElement => child.kind === 'element' && child.tag === 'text',
      )
      if (children.length) {
        const cells = children.map(
          (child, index): Cell => ({
            text: textOf(child).trim(),
            size: number(child.attrs.size, 10),
            align: alignOf(child.attrs.align, index === children.length - 1 ? 'right' : 'left'),
            weight: weightOf(child.attrs.weight),
            tone: toneOf(child.attrs.tone),
          }),
        )
        out.push({
          text: cells.map((cell) => cell.text).join(' '),
          cells,
          size: Math.max(...cells.map((cell) => cell.size)),
          align: 'left',
          weight: 'regular',
          tone: 'ink',
          gap: number(node.attrs.gap, 6),
        })
        return
      }
    }
    if (node.tag === 'tr') {
      const cells = node.children.filter(
        (child): child is ReportElement => child.kind === 'element' && ['td', 'th'].includes(child.tag),
      )
      const values = cells.map(
        (cell, index): Cell => ({
          text: textOf(cell).trim(),
          size: number(cell.attrs.size, 9),
          align: alignOf(cell.attrs.align, index === 0 ? 'left' : 'right'),
          weight: weightOf(cell.attrs.weight, repeat ? 'semibold' : 'regular'),
          tone: toneOf(cell.attrs.tone, repeat ? 'accent' : 'ink'),
        }),
      )
      out.push({
        text: values.map((cell) => cell.text).join(' '),
        cells: values,
        repeat,
        size: Math.max(9, ...values.map((cell) => cell.size)),
        align: 'left',
        weight: repeat ? 'semibold' : 'regular',
        tone: repeat ? 'accent' : 'ink',
        gap: 6,
        rule: true,
      })
      return
    }
    if (node.tag === 'thead') {
      for (const child of node.children) walk(child, out, true)
      return
    }
    for (const child of node.children) walk(child, out, repeat)
  }
  for (const child of root.children) {
    if (child.kind === 'element' && child.tag === 'header') walk(child, header)
    else if (child.kind === 'element' && child.tag === 'footer') walk(child, footer)
    else walk(child, body)
  }
  return { body, header, footer }
}

class Pdf {
  objects: Array<Uint8Array | null> = []
  reserve() {
    this.objects.push(null)
    return this.objects.length
  }
  set(id: number, value: string | Uint8Array) {
    this.objects[id - 1] = typeof value === 'string' ? new TextEncoder().encode(value) : value
  }
  add(value: string | Uint8Array) {
    const id = this.reserve()
    this.set(id, value)
    return id
  }
  stream(bytes: Uint8Array, dictionary = '') {
    const head = new TextEncoder().encode(
      `<< /Length ${bytes.length}${dictionary ? ` ${dictionary}` : ''} >>\nstream\n`,
    )
    const tail = new TextEncoder().encode('\nendstream')
    const out = new Uint8Array(head.length + bytes.length + tail.length)
    out.set(head)
    out.set(bytes, head.length)
    out.set(tail, head.length + bytes.length)
    return this.add(out)
  }
  finish(root: number): Uint8Array {
    const chunks: Uint8Array[] = [new TextEncoder().encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')]
    const offsets = [0]
    let length = chunks[0]!.length
    this.objects.forEach((object, index) => {
      offsets.push(length)
      const head = new TextEncoder().encode(`${index + 1} 0 obj\n`)
      const tail = new TextEncoder().encode('\nendobj\n')
      chunks.push(head, object ?? new Uint8Array(), tail)
      length += head.length + (object?.length ?? 0) + tail.length
    })
    const xrefAt = length
    const rows = offsets.map((offset, index) =>
      index === 0 ? '0000000000 65535 f \n' : `${String(offset).padStart(10, '0')} 00000 n \n`,
    )
    chunks.push(
      new TextEncoder().encode(
        `xref\n0 ${offsets.length}\n${rows.join('')}trailer\n<< /Size ${offsets.length} /Root ${root} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
      ),
    )
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }
}

const hex4 = (value: number) => value.toString(16).padStart(4, '0').toUpperCase()
const points = (value: string) => [...value].map((char) => char.codePointAt(0) ?? 0)

export function renderPdf(document: ReportDocument, options: PdfRenderOptions): Uint8Array {
  const fontBytes: Partial<Record<FontWeight, Uint8Array>> = {
    regular: options.font,
    ...(options.semiboldFont ? { semibold: options.semiboldFont } : {}),
    ...(options.boldFont ? { bold: options.boldFont } : {}),
  }
  const fontWeight = (weight: FontWeight): FontWeight => (fontBytes[weight] ? weight : 'regular')
  const fonts = Object.fromEntries(
    Object.entries(fontBytes).map(([weight, bytes]) => [weight, parseTrueType(bytes)]),
  ) as Partial<Record<FontWeight, ReturnType<typeof parseTrueType>>>
  const paper = document.attrs.paper === 'A5' ? [419.53, 595.28] : [595.28, 841.89]
  if (document.attrs.orientation === 'landscape') paper.reverse()
  const margin = number(document.attrs.margin, 34)
  const margins = {
    top: number(document.attrs['margin-top'], margin),
    right: number(document.attrs['margin-right'], margin),
    bottom: number(document.attrs['margin-bottom'], margin),
    left: number(document.attrs['margin-left'], margin),
  }
  const usable = paper[0]! - margins.left - margins.right
  const source = blocksOf(document)
  const used: Record<FontWeight, Map<number, number>> = {
    regular: new Map(),
    semibold: new Map(),
    bold: new Map(),
  }
  const encode = (text: string, asked: FontWeight) => {
    const weight = fontWeight(asked)
    const font = fonts[weight]!
    return points(text)
      .map((point) => {
        const glyph = font.glyphOf(point)
        used[weight].set(glyph, point)
        return hex4(glyph)
      })
      .join('')
  }
  const measure = (text: string, size: number, asked: FontWeight) => {
    const font = fonts[fontWeight(asked)]!
    return (
      points(text).reduce((sum, point) => sum + font.widthOf(font.glyphOf(point)), 0) *
      (size / font.unitsPerEm)
    )
  }
  const wrap = (line: Line): Line[] => {
    if (line.cells || line.image) return [line]
    const words = line.text.split(/\s+/).filter(Boolean)
    const rows: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (current && measure(next, line.size, line.weight) > usable) {
        rows.push(current)
        current = word
      } else current = next
    }
    if (current || !rows.length) rows.push(current)
    return rows.map((text) => ({ ...line, text }))
  }
  const headerHeight =
    source.header.reduce((sum, line) => sum + line.size * 1.3 + line.gap, 0) + (source.header.length ? 12 : 0)
  const footerHeight = source.footer.reduce((sum, line) => sum + line.size * 1.3 + line.gap, 0)
  const pages: Line[][] = [[]]
  let usedHeight = 0
  const capacity = paper[1]! - margins.top - margins.bottom - headerHeight - footerHeight
  const repeated = source.body.filter(
    (block): block is Line => !('pageBreak' in block) && block.repeat === true,
  )
  for (const block of source.body) {
    if ('pageBreak' in block) {
      if (pages.at(-1)!.length) pages.push([])
      usedHeight = 0
      continue
    }
    for (const line of wrap(block)) {
      const height = line.image ? (line.imageHeight ?? 48) + line.gap : line.size * 1.3 + line.gap
      if (usedHeight + height > capacity && pages.at(-1)!.length) {
        pages.push([...repeated])
        usedHeight = repeated.reduce((sum, held) => sum + held.size * 1.3 + held.gap, 0)
      }
      pages.at(-1)!.push(line)
      usedHeight += height
    }
  }
  if (pages.length > (options.maxPages ?? 200))
    throw new Error(`report exceeds ${options.maxPages ?? 200} pages`)

  const imageDefinitions = new Map(
    Object.entries(options.images ?? {}).map(([key, value], index) => [
      key,
      { name: `I${index + 1}`, image: parseImage(value) },
    ]),
  )

  const contentFor = (lines: Line[], pageNumber: number) => {
    const out: string[] = []
    const fontName = (weight: FontWeight) =>
      fontWeight(weight) === 'bold' ? 'F3' : fontWeight(weight) === 'semibold' ? 'F2' : 'F1'
    const color = (tone: Tone) =>
      tone === 'accent' ? '0.271 0.341 0.624' : tone === 'muted' ? '0.353 0.361 0.369' : '0.141 0.149 0.165'
    const draw = (line: Line, y: number) => {
      if (line.image) {
        const held = imageDefinitions.get(line.image)
        if (!held) throw new Error(`report image "${line.image}" was not provided`)
        const width = Math.min(line.imageWidth ?? 96, usable)
        const height = line.imageHeight ?? (width * held.image.height) / held.image.width
        const x =
          line.align === 'center'
            ? margins.left + (usable - width) / 2
            : line.align === 'right'
              ? paper[0]! - margins.right - width
              : margins.left
        out.push(
          `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${(y - height).toFixed(2)} cm /${held.name} Do Q`,
        )
        return
      }
      if (line.cells?.length) {
        const cellWidth = usable / line.cells.length
        if (line.repeat) {
          const height = line.size * 1.3 + line.gap
          out.push(
            `q 0.933 0.941 0.984 rg ${margins.left} ${(y - 5).toFixed(2)} ${usable.toFixed(2)} ${height.toFixed(2)} re f Q`,
          )
        }
        line.cells.forEach((cell, index) => {
          const width = measure(cell.text, cell.size, cell.weight)
          const start = margins.left + cellWidth * index
          const x =
            cell.align === 'center'
              ? start + (cellWidth - width) / 2
              : cell.align === 'right'
                ? start + cellWidth - width - (index === line.cells!.length - 1 ? 0 : 4)
                : start + (index === 0 ? 0 : 4)
          out.push(
            `q ${color(cell.tone)} rg BT /${fontName(cell.weight)} ${cell.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${encode(cell.text, cell.weight)}> Tj ET Q`,
          )
        })
        if (line.rule)
          out.push(
            `0.85 G ${margins.left} ${(y - 4).toFixed(2)} m ${paper[0]! - margins.right} ${(y - 4).toFixed(2)} l S`,
          )
        return
      }
      const width = measure(line.text, line.size, line.weight)
      const x =
        line.align === 'center'
          ? margins.left + (usable - width) / 2
          : line.align === 'right'
            ? paper[0]! - margins.right - width
            : margins.left
      out.push(
        `q ${color(line.tone)} rg BT /${fontName(line.weight)} ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${encode(line.text, line.weight)}> Tj ET Q`,
      )
      if (line.rule)
        out.push(
          `0.85 G ${margins.left} ${(y - 4).toFixed(2)} m ${paper[0]! - margins.right} ${(y - 4).toFixed(2)} l S`,
        )
    }
    let y = paper[1]! - margins.top
    for (const line of source.header) {
      draw(line, y)
      y -= line.size * 1.3 + line.gap
    }
    if (source.header.length) {
      out.push(
        `0.765 0.804 0.941 RG ${margins.left} ${(y - 2).toFixed(2)} m ${paper[0]! - margins.right} ${(y - 2).toFixed(2)} l S`,
      )
      y -= 12
    }
    for (const line of lines) {
      draw(line, y)
      y -= line.image ? (line.imageHeight ?? 48) + line.gap : line.size * 1.3 + line.gap
    }
    y = margins.bottom + footerHeight
    if (source.footer.length)
      out.push(
        `0.867 0.863 0.871 RG ${margins.left} ${(y + 7).toFixed(2)} m ${paper[0]! - margins.right} ${(y + 7).toFixed(2)} l S`,
      )
    for (const line of source.footer) {
      draw(
        {
          ...line,
          text: line.text
            .replaceAll('{page}', String(pageNumber))
            .replaceAll('{pages}', String(pages.length)),
          cells: line.cells?.map((cell) => ({
            ...cell,
            text: cell.text
              .replaceAll('{page}', String(pageNumber))
              .replaceAll('{pages}', String(pages.length)),
          })),
        },
        y,
      )
      y -= line.size * 1.3 + line.gap
    }
    return new TextEncoder().encode(out.join('\n'))
  }

  // Build page content first so the glyph inventory used by the embedded font is complete.
  const contents = pages.map((lines, index) => contentFor(lines, index + 1))
  const pdf = new Pdf()
  const pagesId = pdf.reserve()
  const catalogId = pdf.reserve()
  const fontResourceNames: Record<FontWeight, string> = { regular: 'F1', semibold: 'F2', bold: 'F3' }
  const fontIds = new Map<FontWeight, number>()
  for (const weight of ['regular', 'semibold', 'bold'] as const) {
    const font = fonts[weight]
    if (!font || used[weight].size === 0) continue
    const baseName = weight === 'regular' ? 'Inter' : weight === 'semibold' ? 'Inter-SemiBold' : 'Inter-Bold'
    const fontFile = pdf.stream(font.bytes, `/Length1 ${font.bytes.length}`)
    const descriptor = pdf.add(
      `<< /Type /FontDescriptor /FontName /${baseName} /Flags 32 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent ${Math.round((font.ascent * 1000) / font.unitsPerEm)} /Descent ${Math.round((font.descent * 1000) / font.unitsPerEm)} /CapHeight 750 /StemV ${weight === 'regular' ? 80 : weight === 'semibold' ? 105 : 130} /FontFile2 ${fontFile} 0 R >>`,
    )
    const mappings = [...used[weight].entries()]
      .map(
        ([glyph, point]) =>
          `<${hex4(glyph)}> <${point <= 0xffff ? hex4(point) : `D${hex4(0x7c0 + (point >> 10))}D${hex4(0xdc00 + (point & 0x3ff))}`}>`,
      )
      .join('\n')
    const toUnicode = pdf.stream(
      new TextEncoder().encode(
        `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /${baseName}-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${used[weight].size} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
      ),
    )
    const widths = [...used[weight].keys()]
      .sort((a, b) => a - b)
      .map((glyph) => `${glyph} [${Math.round((font.widthOf(glyph) * 1000) / font.unitsPerEm)}]`)
      .join(' ')
    const cid = pdf.add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`,
    )
    fontIds.set(
      weight,
      pdf.add(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
      ),
    )
  }
  const imageObjects = new Map(
    [...imageDefinitions].map(([key, held]) => [
      key,
      {
        ...held,
        id: pdf.stream(
          held.image.bytes,
          `/Type /XObject /Subtype /Image /Width ${held.image.width} /Height ${held.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${held.image.filter}`,
        ),
      },
    ]),
  )
  const imageResources = [...imageObjects.values()].map((held) => `/${held.name} ${held.id} 0 R`).join(' ')
  const fontResources = [...fontIds.entries()]
    .map(([weight, id]) => `/${fontResourceNames[weight]} ${id} 0 R`)
    .join(' ')
  const pageIds = contents.map((content) => {
    const contentId = pdf.stream(content)
    return pdf.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${paper[0]} ${paper[1]}] /Resources << /Font << ${fontResources} >>${imageResources ? ` /XObject << ${imageResources} >>` : ''} >> /Contents ${contentId} 0 R >>`,
    )
  })
  pdf.set(
    pagesId,
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  )
  pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  return pdf.finish(catalogId)
}
