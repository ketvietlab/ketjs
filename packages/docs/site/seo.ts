import type { PageHead } from '@ketvietlab/ketjs-view-tools'
import { frameworkVersion } from './release.ts'
import type { ContentPage } from './model.ts'
import { blogDetails } from './blog-data.mjs'

export const origin = 'https://ketjs.dev'
const image = `${origin}/social.png`
const website = { '@id': `${origin}/#website` }

// One metadata model serves native SSG and subsequent island navigation.
export function pageHead(route: string, page?: ContentPage): PageHead {
  const label = page?.title ?? (route === '/search/' ? 'Search KetJS documentation' : 'Page not found')
  const title = /\bKetJS\b/.test(label) ? label : `${label} | KetJS`
  const description =
    page?.description ??
    (route === '/search/'
      ? 'Find KetJS documentation, learning guides and runnable examples. Browse topics including modules, data, rendering, authorization and jobs.'
      : 'This KetJS page could not be found. Return to the homepage or browse the documentation to find the guide or example you need.')
  const url = `${origin}${route}`
  const noindex = ['/search/', '/404/'].includes(route)
  const article = Boolean(page && page.slug !== 'index' && page.kind !== 'home')
  const structuredData: Readonly<Record<string, unknown>>[] = []
  if (page && !noindex) {
    structuredData.push({
      '@context': 'https://schema.org',
      '@type': article
        ? page.kind === 'blog'
          ? 'BlogPosting'
          : 'TechArticle'
        : page.kind === 'home'
          ? 'WebPage'
          : 'CollectionPage',
      '@id': `${url}#page`,
      url,
      name: label,
      headline: label,
      description,
      inLanguage: 'en',
      isPartOf: website,
      ...(article ? { mainEntityOfPage: url } : {}),
      ...(page.kind === 'blog'
        ? {
            ...(blogDetails(page).date ? { datePublished: blogDetails(page).date } : {}),
            ...(article
              ? {
                  author: { '@type': 'Organization', name: blogDetails(page).author },
                  articleSection: blogDetails(page).category,
                }
              : {}),
          }
        : page.date && /^\d{4}-\d{2}-\d{2}$/.test(page.date)
          ? { datePublished: page.date }
          : {}),
    })
    if (route === '/') {
      structuredData.push(
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          ...website,
          url: `${origin}/`,
          name: 'KetJS',
          inLanguage: 'en',
        },
        {
          '@context': 'https://schema.org',
          '@type': 'SoftwareSourceCode',
          '@id': `${origin}/#framework`,
          name: 'KetJS',
          description,
          url: `${origin}/`,
          codeRepository: 'https://github.com/ketvietlab/ketjs',
          programmingLanguage: 'TypeScript',
          version: frameworkVersion,
          license: 'https://opensource.org/license/mit',
        },
      )
    } else {
      const crumbs = [{ name: 'KetJS', item: `${origin}/` }]
      if (page.slug !== 'index')
        crumbs.push({
          name:
            page.kind === 'docs'
              ? 'Documentation'
              : page.kind === 'learn'
                ? 'Learn'
                : page.kind === 'examples'
                  ? 'Examples'
                  : 'Blog',
          item: `${origin}/${page.kind}/`,
        })
      crumbs.push({ name: label, item: url })
      structuredData.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          ...crumb,
        })),
      })
    }
  }
  return {
    title,
    description,
    lang: 'en',
    structuredData,
    scripts: [{ src: '/theme-init.js' }],
    links: [
      { rel: 'canonical', href: url },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
    meta: [
      { name: 'robots', content: noindex ? 'noindex,follow' : 'index,follow' },
      { name: 'theme-color', content: '#5766db' },
      { property: 'og:site_name', content: 'KetJS' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:type', content: article ? 'article' : 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'KetJS Preview — composable modules and explicit contracts' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: 'KetJS Preview — composable modules and explicit contracts' },
    ],
  }
}

export function updatePageHead(page: ContentPage) {
  const head = pageHead(page.route, page)
  document.title = head.title
  const description = document.querySelector('meta[name="description"]')
  description?.setAttribute('content', head.description!)
  for (const meta of head.meta ?? []) {
    const attribute = meta.property === undefined ? 'name' : 'property'
    const value = meta.property ?? meta.name!
    let node = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`)
    if (!node) {
      node = document.createElement('meta')
      node.setAttribute(attribute, value)
      document.head.append(node)
    }
    node.content = meta.content
  }
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${origin}${page.route}`)
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) node.remove()
  for (const data of head.structuredData ?? []) {
    const node = document.createElement('script')
    node.type = 'application/ld+json'
    node.textContent = JSON.stringify(data)
    document.head.append(node)
  }
}
