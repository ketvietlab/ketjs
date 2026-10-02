export function publicMetadata(data) {
  const seo = data.seo ?? {}
  let canonical = null
  try {
    const url = new URL(
      seo.canonical || data.entry?.path || data.archive?.path || '/',
      `https://${data.site.host}`,
    )
    if (url.protocol === 'https:' && !url.username && !url.password) canonical = url.href
  } catch {}
  return {
    title: seo.title || data.entry?.title || data.archive?.title || data.site.name,
    description: seo.description || '',
    robots:
      data.search || seo.indexing === 'noindex' || (!data.entry && !data.archive)
        ? 'noindex, nofollow'
        : 'index, follow',
    canonical,
    image: seo.image || '',
  }
}
export function applyPageMetadata(document, meta) {
  if (!document?.head) return
  for (const node of document.head.querySelectorAll('[data-website-meta]')) node.remove()
  document.title = meta?.title || 'Website · KétSuite'
  if (!meta) return
  const add = (tag, attributes) => {
    const node = document.createElement(tag)
    node.setAttribute('data-website-meta', '')
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
    document.head.append(node)
  }
  add('meta', { name: 'description', content: meta.description })
  add('meta', { name: 'robots', content: meta.robots })
  add('meta', { property: 'og:title', content: meta.title })
  if (meta.image) add('meta', { property: 'og:image', content: meta.image })
  if (meta.canonical) add('link', { rel: 'canonical', href: meta.canonical })
}
