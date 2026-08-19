// A tiny HTML template parser. It runs over the *static* strings of a tagged
// template, which are stable per call site by spec — so this runs once per call
// site for the life of the process, and every later render only touches holes.

export type TplText = { type: 'text'; value: string }
export type TplHole = { type: 'hole'; index: number }
export type TplAttr = { name: string; value?: string; hole?: number }
export type TplEl = { type: 'el'; tag: string; attrs: TplAttr[]; children: TplNode[] }
export type TplNode = TplText | TplHole | TplEl
export type TplRoot = { type: 'root'; children: TplNode[] }

const MARK = '￼' // OBJECT REPLACEMENT CHARACTER: never appears in real markup
const holeRe = new RegExp(MARK + '(\\d+)' + MARK)
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

export function parseTemplate(strings: readonly string[]): TplRoot {
  const src = strings.reduce((acc, s, i) => acc + s + (i < strings.length - 1 ? MARK + i + MARK : ''), '')
  let i = 0
  const root: TplRoot = { type: 'root', children: [] }
  const stack: Array<TplRoot | TplEl> = [root]
  const top = () => stack[stack.length - 1] as TplRoot | TplEl

  const pushText = (raw: string): void => {
    let rest = raw
    for (;;) {
      if (!rest) return
      const m = holeRe.exec(rest)
      if (!m) {
        top().children.push({ type: 'text', value: rest })
        return
      }
      if (m.index > 0) top().children.push({ type: 'text', value: rest.slice(0, m.index) })
      top().children.push({ type: 'hole', index: Number(m[1]) })
      rest = rest.slice(m.index + m[0].length)
    }
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      pushText(src.slice(i))
      break
    }
    pushText(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3
      continue
    }

    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = gt + 1
      continue
    }

    let j = lt + 1
    while (j < src.length && /[^\s/>]/.test(src[j] as string)) j++
    const tag = src.slice(lt + 1, j)
    const attrs: TplAttr[] = []
    for (;;) {
      while (j < src.length && /\s/.test(src[j] as string)) j++
      if (src[j] === '>' || src.startsWith('/>', j)) break
      let k = j
      while (k < src.length && /[^\s=/>]/.test(src[k] as string)) k++
      const name = src.slice(j, k)
      if (!name) {
        j = k + 1
        continue
      }
      while (k < src.length && /\s/.test(src[k] as string)) k++
      if (src[k] !== '=') {
        attrs.push({ name, value: '' })
        j = k
        continue
      }
      k++
      while (k < src.length && /\s/.test(src[k] as string)) k++
      let raw: string
      const ch = src[k]
      if (ch === '"' || ch === "'") {
        const end = src.indexOf(ch, k + 1)
        raw = src.slice(k + 1, end)
        k = end + 1
      } else {
        let e = k
        while (e < src.length && !/[\s/>]/.test(src[e] as string)) e++
        raw = src.slice(k, e)
        k = e
      }
      const hm = holeRe.exec(raw)
      if (hm && hm[0] === raw) attrs.push({ name, hole: Number(hm[1]) })
      else attrs.push({ name, value: raw })
      j = k
    }
    const selfClosing = src.startsWith('/>', j)
    const gt = src.indexOf('>', j)
    const el: TplEl = { type: 'el', tag, attrs, children: [] }
    top().children.push(el)
    if (!selfClosing && !VOID.has(tag)) stack.push(el)
    i = gt + 1
  }
  return root
}

const cache = new WeakMap<readonly string[], TplRoot>()
export function templateFor(strings: readonly string[]): TplRoot {
  let t = cache.get(strings)
  if (!t) {
    t = parseTemplate(strings)
    cache.set(strings, t)
  }
  return t
}
