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

/**
 * A value is a hole, or it is nothing.
 *
 * A hole substitutes for one whole thing: a child, or the entire value of one
 * attribute. Anywhere else, the marker is not a hole the renderer knows how to
 * fill — it is a character in a static string, and it used to reach the page as
 * one. `class="a ${x}"` rendered `class="a ￼0￼"`, silently, on the server and in
 * the browser alike.
 *
 * Parsing runs once per call site for the life of the process, so refusing here
 * costs nothing at render time and turns a bug you have to see to believe into one
 * the first render names.
 */
class TemplateError extends Error {
  code = 'E_TEMPLATE_HOLE'
  hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'TemplateError'
    this.hint = hint
  }
}

const hasMark = (value: string): boolean => value.includes(MARK)
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
    if (hasMark(tag)) {
      throw new TemplateError(
        'an element name cannot be a hole',
        'the tag decides the shape of the tree, which is fixed per call site — branch with when() and write each tag out',
      )
    }
    const attrs: TplAttr[] = []
    for (;;) {
      while (j < src.length && /\s/.test(src[j] as string)) j++
      if (src[j] === '>' || src.startsWith('/>', j)) break
      let k = j
      while (k < src.length && /[^\s=/>]/.test(src[k] as string)) k++
      const name = src.slice(j, k)
      if (hasMark(name)) {
        throw new TemplateError(
          'an attribute name cannot be a hole',
          'a hole fills an attribute value; to add an attribute conditionally, pass null as its value',
        )
      }
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
      if (hm && hm[0] !== raw) {
        throw new TemplateError(
          `an attribute takes a whole value or none: "${name}" mixes a hole with static text`,
          `write ${name}=\${...} and build the whole value in the expression, not "text \${...}"`,
        )
      }
      if (hm) attrs.push({ name, hole: Number(hm[1]) })
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
