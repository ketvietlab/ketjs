import { KetError } from '../kernel/errors.ts'

export type ReportText = { kind: 'text'; value: string }
export type ReportElement = {
  kind: 'element'
  tag: ReportTag
  attrs: Record<string, string>
  children: ReportNode[]
}
export type ReportNode = ReportText | ReportElement
export type ReportDocument = ReportElement

export type ReportTag =
  | 'report'
  | 'header'
  | 'footer'
  | 'section'
  | 'stack'
  | 'row'
  | 'text'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'image'
  | 'page-break'

const TAGS = new Set<ReportTag>([
  'report',
  'header',
  'footer',
  'section',
  'stack',
  'row',
  'text',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'image',
  'page-break',
])
const ATTRS = new Set([
  'paper',
  'orientation',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'size',
  'weight',
  'align',
  'gap',
  'width',
  'height',
  'columns',
  'label',
  'src',
  'alt',
])

const entities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const point =
      entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return Number.isFinite(point) ? String.fromCodePoint(point) : ''
  })

export function parseReportMarkup(
  source: string,
  limits: { maxNodes?: number; maxText?: number } = {},
): ReportDocument {
  if (source.length > (limits.maxText ?? 1_000_000))
    throw new KetError({
      code: 'E_REPORT_MARKUP_LIMIT',
      message: 'rendered report markup exceeds its size limit',
    })
  if (/<!DOCTYPE|<!ENTITY|<\?|<!--/i.test(source))
    throw new KetError({
      code: 'E_REPORT_MARKUP_UNSAFE',
      message: 'report markup cannot contain declarations',
    })

  const roots: ReportNode[] = []
  const stack: ReportElement[] = []
  const token = /<[^>]+>|[^<]+/g
  let count = 0
  for (const match of source.matchAll(token)) {
    const value = match[0]
    if (!value.startsWith('<')) {
      if (!value.trim()) continue
      const node: ReportText = { kind: 'text', value: entities(value) }
      ;(stack.at(-1)?.children ?? roots).push(node)
      count++
      continue
    }
    if (value.startsWith('</')) {
      const name = value.slice(2, -1).trim()
      const open = stack.pop()
      if (!open || open.tag !== name)
        throw new KetError({ code: 'E_REPORT_MARKUP_CLOSE', message: `unexpected closing tag </${name}>` })
      continue
    }
    const selfClosing = value.endsWith('/>')
    const inside = value.slice(1, selfClosing ? -2 : -1).trim()
    const name = inside.match(/^[a-z][a-z-]*/)?.[0] as ReportTag | undefined
    if (!name || !TAGS.has(name))
      throw new KetError({ code: 'E_REPORT_MARKUP_TAG', message: `unsupported report tag <${name ?? '?'}>` })
    const attrs: Record<string, string> = {}
    const rest = inside.slice(name.length)
    let consumed = ''
    for (const attr of rest.matchAll(/\s+([a-z][a-z-]*)\s*=\s*(["'])(.*?)\2/g)) {
      const key = attr[1] as string
      if (!ATTRS.has(key))
        throw new KetError({
          code: 'E_REPORT_MARKUP_ATTR',
          message: `unsupported attribute "${key}" on <${name}>`,
        })
      attrs[key] = entities(attr[3] as string)
      consumed += attr[0]
    }
    if (rest.trim() !== consumed.trim())
      throw new KetError({ code: 'E_REPORT_MARKUP_ATTR', message: `malformed attribute on <${name}>` })
    const node: ReportElement = { kind: 'element', tag: name, attrs, children: [] }
    ;(stack.at(-1)?.children ?? roots).push(node)
    count++
    if (count > (limits.maxNodes ?? 20_000))
      throw new KetError({ code: 'E_REPORT_MARKUP_LIMIT', message: 'report markup has too many nodes' })
    if (!selfClosing && name !== 'page-break' && name !== 'image') stack.push(node)
  }
  if (stack.length)
    throw new KetError({
      code: 'E_REPORT_MARKUP_OPEN',
      message: `unclosed report tag <${stack.at(-1)?.tag}>`,
    })
  if (roots.length !== 1 || roots[0]?.kind !== 'element' || roots[0].tag !== 'report')
    throw new KetError({
      code: 'E_REPORT_MARKUP_ROOT',
      message: 'report markup needs exactly one <report> root',
    })
  return roots[0]
}

const esc = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function renderReportHtml(document: ReportDocument): string {
  const render = (node: ReportNode): string => {
    if (node.kind === 'text') return esc(node.value)
    if (node.tag === 'page-break') return '<div class="ket-report-page-break"></div>'
    if (node.tag === 'image')
      return `<div class="ket-report-image" data-image-key="${esc(node.attrs.src ?? '')}" aria-label="${esc(node.attrs.alt ?? '')}"></div>`
    const tag = ['table', 'thead', 'tbody', 'tr'].includes(node.tag)
      ? node.tag
      : node.tag === 'th' || node.tag === 'td'
        ? node.tag
        : 'div'
    const attrs = Object.entries(node.attrs)
      .map(([key, value]) => ` data-${key}="${esc(value)}"`)
      .join('')
    return `<${tag} class="ket-report-${node.tag}"${attrs}>${node.children.map(render).join('')}</${tag}>`
  }
  return render(document)
}
