/** A site-relative path or an http(s) URL without credentials. */
export const validHref = (value: unknown): boolean => {
  const href = String(value ?? '').trim()
  const hasControl = [...href].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\') && !hasControl) return true
  try {
    const url = new URL(href)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}
