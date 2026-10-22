// A bound URL attribute is the one place a value from data can choose to run
// script: following `href="javascript:..."` executes it with the page's origin.
// Escaping cannot help, because the attack is the scheme, not the characters. So
// the renderers pass every bound value of a URL attribute through `safeUrl()`,
// which leaves ordinary and relative URLs alone and turns a scripting scheme into
// an inert `unsafe:` URL, the way Angular does. A static attribute the author
// wrote in the template is not data and is left as written.

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'data',
  'cite',
])

/** Whether a browser follows or loads this attribute's value as a URL. */
export const isUrlAttribute = (name: string): boolean => URL_ATTRIBUTES.has(name.toLowerCase())

// The URL parser drops leading and trailing controls and spaces and removes tabs and
// newlines anywhere, so "  java\tscript:" is still javascript:. Dropping every
// control and space before reading the scheme is the stricter of the two readings.
// Sixteen characters are enough to read "javascript:", "vbscript:" or "data:image/".
const SCRIPTING = /^(?:javascript|vbscript):/
// Inline media is a common, inert use of data: (icons, previews). Every other data:
// type, text/html above all, is a document the browser could render.
const DATA_MEDIA = /^data:(?:image|video|audio)\//

/**
 * The value to render for a URL attribute bound from data. `javascript:`,
 * `vbscript:` and `data:` other than image, video or audio become `unsafe:<value>`,
 * which a browser will not follow. Null, undefined and booleans pass through, so a
 * renderer still omits the attribute as it would without this check.
 */
export const safeUrl = (value: unknown): unknown => {
  if (value == null || typeof value === 'boolean') return value
  const text = String(value)
  let scheme = ''
  for (let i = 0; i < text.length && scheme.length < 16; i++) {
    const code = text.charCodeAt(i)
    if (code > 0x20 && code !== 0x7f) scheme += text[i]
  }
  scheme = scheme.toLowerCase()
  if (SCRIPTING.test(scheme) || (scheme.startsWith('data:') && !DATA_MEDIA.test(scheme)))
    return `unsafe:${text}`
  return text
}

/** The value a renderer writes for a bound attribute. */
export const attributeValue = (name: string, value: unknown): unknown =>
  isUrlAttribute(name) ? safeUrl(value) : value
