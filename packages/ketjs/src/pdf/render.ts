import type { ReportDocument, ReportElement, ReportNode } from './markup.ts'
import { parseTrueType } from './font.ts'
import { parseImage } from './image.ts'

export type PdfRenderOptions = {
  font: Uint8Array
  /** Attachment bytes keyed by the `<image src="...">` identifier. */
  images?: Record<string, Uint8Array>
  maxPages?: number
}

type Line = {
  text: string
  size: number
  align: 'left' | 'center' | 'right'
  gap: number
  rule?: boolean
  cells?: string[]
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

function blocksOf(root: ReportElement): { body: Block[]; header: Line[]; footer: Line[] } {
  const body: Block[] = []
  const header: Line[] = []
  const footer: Line[] = []
  const walk = (node: ReportNode, out: Block[], repeat = false) => {
    if (node.kind === 'text') {
      if (node.value.trim()) out.push({ text: node.value.trim(), size: 10, align: 'left', gap: 4 })
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
        align: (['center', 'right'].includes(node.attrs.align ?? '')
          ? node.attrs.align
          : 'left') as Line['align'],
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
        align: (['center', 'right'].includes(node.attrs.align ?? '')
          ? node.attrs.align
          : 'left') as Line['align'],
        gap: number(node.attrs.gap, 8),
      })
      return
    }
    if (node.tag === 'tr') {
      const cells = node.children.filter(
        (child): child is ReportElement => child.kind === 'element' && ['td', 'th'].includes(child.tag),
      )
      const values = cells.map((cell) => textOf(cell).trim())
      out.push({ text: values.join(' '), cells: values, repeat, size: 9, align: 'left', gap: 5, rule: true })
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
  const font = parseTrueType(options.font)
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
  const used = new Map<number, number>()
  const encode = (text: string) =>
    points(text)
      .map((point) => {
        const glyph = font.glyphOf(point)
        used.set(glyph, point)
        return hex4(glyph)
      })
      .join('')
  const measure = (text: string, size: number) =>
    points(text).reduce((sum, point) => sum + font.widthOf(font.glyphOf(point)), 0) * (size / font.unitsPerEm)
  const wrap = (line: Line): Line[] => {
    if (line.cells || line.image) return [line]
    const words = line.text.split(/\s+/).filter(Boolean)
    const rows: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (current && measure(next, line.size) > usable) {
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
        line.cells.forEach((cell, index) => {
          const width = measure(cell, line.size)
          const x = index === 0 ? margins.left : margins.left + cellWidth * (index + 1) - width - 4
          out.push(
            `BT /F1 ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${encode(cell)}> Tj ET`,
          )
        })
        if (line.rule)
          out.push(
            `0.85 G ${margins.left} ${(y - 4).toFixed(2)} m ${paper[0]! - margins.right} ${(y - 4).toFixed(2)} l S`,
          )
        return
      }
      const width = measure(line.text, line.size)
      const x =
        line.align === 'center'
          ? margins.left + (usable - width) / 2
          : line.align === 'right'
            ? paper[0]! - margins.right - width
            : margins.left
      out.push(
        `BT /F1 ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${encode(line.text)}> Tj ET`,
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
    if (source.header.length) y -= 12
    for (const line of lines) {
      draw(line, y)
      y -= line.image ? (line.imageHeight ?? 48) + line.gap : line.size * 1.3 + line.gap
    }
    y = margins.bottom + footerHeight
    for (const line of source.footer) {
      draw(
        {
          ...line,
          text: line.text
            .replaceAll('{page}', String(pageNumber))
            .replaceAll('{pages}', String(pages.length)),
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
  const fontFile = pdf.stream(font.bytes, `/Length1 ${font.bytes.length}`)
  const descriptor = pdf.add(
    `<< /Type /FontDescriptor /FontName /Inter /Flags 32 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent ${Math.round((font.ascent * 1000) / font.unitsPerEm)} /Descent ${Math.round((font.descent * 1000) / font.unitsPerEm)} /CapHeight 750 /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  )
  const mappings = [...used.entries()]
    .map(
      ([glyph, point]) =>
        `<${hex4(glyph)}> <${point <= 0xffff ? hex4(point) : `D${hex4(0x7c0 + (point >> 10))}D${hex4(0xdc00 + (point & 0x3ff))}`}>`,
    )
    .join('\n')
  const toUnicode = pdf.stream(
    new TextEncoder().encode(
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Inter-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${used.size} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
    ),
  )
  const widths = [...used.keys()]
    .sort((a, b) => a - b)
    .map((glyph) => `${glyph} [${Math.round((font.widthOf(glyph) * 1000) / font.unitsPerEm)}]`)
    .join(' ')
  const cid = pdf.add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Inter /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`,
  )
  const type0 = pdf.add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /Inter /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  )
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
  const pageIds = contents.map((content) => {
    const contentId = pdf.stream(content)
    return pdf.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${paper[0]} ${paper[1]}] /Resources << /Font << /F1 ${type0} 0 R >>${imageResources ? ` /XObject << ${imageResources} >>` : ''} >> /Contents ${contentId} 0 R >>`,
    )
  })
  pdf.set(
    pagesId,
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  )
  pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  return pdf.finish(catalogId)
}
