import { resourceSchemas } from './resources.ts'
import type { WebsiteRoute } from './extensions.ts'
// Core route vocabulary. Paths are relative to the Studio base (`/website/`); Atlas screen IDs
// live in the KetAtlas bundle, never here. Extensions add routes through extensions.ts.

/** Sidebar groups in display order. Extensions may only place entries in these groups. */
export const navGroups = Object.freeze(['home', 'content', 'experience', 'settings'])

export const coreRoutes: Record<string, WebsiteRoute> = {
  overview: {
    title: 'website.route.overview',
    path: 'overview',
    nav: { group: 'home', icon: 'layout-dashboard' },
  },
  pages: {
    title: 'website.route.pages',
    path: 'pages',
    nav: { group: 'content', icon: 'file-text' },
    query: ['q', 'status'],
  },
  'page-new': {
    title: 'website.route.pageNew',
    path: 'pages/new',
    modal: { back: 'pages' },
    capability: 'website.content.write',
  },
  builder: {
    title: 'website.route.builder',
    path: 'pages/:id/builder',
    frame: 'workspace',
    query: ['node', 'panel', 'inspector', 'field', 'tools', 'section', 'dialog'],
  },
  posts: {
    title: 'website.route.posts',
    path: 'posts',
    nav: { group: 'content', icon: 'newspaper' },
    query: ['q', 'status'],
  },
  'post-new': {
    title: 'website.route.postNew',
    path: 'posts/new',
    capability: 'website.content.write',
  },
  'post-edit': { title: 'website.route.postEdit', path: 'posts/:id' },
  'entry-details': {
    title: 'website.route.entryDetails',
    path: 'entries/:id',
    capability: 'website.content.write',
  },
  preview: {
    title: 'website.route.preview',
    path: 'preview/:id',
    query: ['revision', 'token', 'device', 'profile'],
    frame: 'workspace',
  },
  'visitor-receipt': {
    title: 'website.formJourney.sent',
    path: 'visit/forms/receipt/:id',
    frame: 'workspace',
  },
  forms: {
    title: 'website.route.forms',
    path: 'forms',
    nav: { group: 'experience', icon: 'clipboard-list' },
  },
  submissions: { title: 'website.route.submissions', path: 'forms/:id/submissions', query: ['status'] },
  'submission-detail': {
    title: 'website.route.submissions',
    path: 'submissions/:id',
    capability: 'website.submission.manage',
  },
  'visitor-form': { title: 'website.route.forms', path: 'visit/forms/:id', frame: 'workspace' },
  settings: {
    title: 'website.route.settings',
    path: 'settings',
    nav: { group: 'settings', icon: 'settings' },
    capability: 'website.site.manage',
  },
  customers: {
    title: 'website.route.customers',
    path: 'customers',
    query: ['q', 'status'],
    nav: { group: 'experience', icon: 'users' },
    capability: 'website.customer.manage',
  },
  'customer-new': {
    title: 'website.route.customerNew',
    path: 'customers/new',
    query: ['find', 'partner'],
    modal: { back: 'customers' },
    capability: 'website.customer.issue',
  },
  customer: {
    title: 'website.route.customers',
    path: 'customers/:id',
    modal: { back: 'customers' },
    capability: 'website.customer.manage',
  },
}

for (const [key, type, icon] of [
  ['categories', 'category', 'folder-tree'],
  ['tags', 'tag', 'tag'],
]) {
  coreRoutes[key] = {
    title: `website.route.${key}`,
    path: key,
    query: ['q'],
    nav: { group: 'content', icon },
    capability: 'website.content.write',
  }
  coreRoutes[`${type}-edit`] = {
    title: `website.route.${key}`,
    path: `${key}/:id`,
    capability: 'website.content.write',
  }
}

for (const [key, schema] of Object.entries(resourceSchemas)) {
  const icons: Record<string, string> = {
    taxonomy: 'tag',
    'taxonomy-sets': 'tag',
    menus: 'menu',
    domains: 'globe',
    seo: 'search',
    themes: 'palette',
    sites: 'globe',
    templates: 'layout-dashboard',
  }
  coreRoutes[key] = {
    title: `website.route.${key}`,
    path: key === 'domains' ? 'settings/domains' : key,
    scope: key === 'sites' ? 'company' : 'site',
    nav: ['form-editor', 'taxonomy', 'taxonomy-sets', 'templates', 'domains', 'sites'].includes(key)
      ? undefined
      : { group: schema.group, icon: icons[key] ?? 'file-text' },
    query: ['q', 'set'],
    capability: schema.capability,
  }
  coreRoutes[`${key}-edit`] = {
    title: `website.route.${key}`,
    path: key === 'domains' ? 'settings/domains/:id' : key === 'sites' ? 'sites/new' : `${key}/:id`,
    scope: key === 'sites' ? 'company' : 'site',
    query: ['set'],
    capability: schema.capability,
  }
}

const compile = (path: string) => {
  const names: string[] = []
  const source = path
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(part.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { names, pattern: new RegExp(`^${source}$`) }
}

/**
 * Resolve a Studio-relative path against a route table. Literal paths win over parameters, so
 * `pages/new` never resolves as a page called "new".
 */
export function matchRoute(
  table: Record<string, WebsiteRoute>,
  path: string,
): { key: string; params: Record<string, string> } | null {
  const clean = path.replace(/^\/+|\/+$/g, '') || 'overview'
  const candidates = Object.entries(table).sort(
    ([, a], [, b]) => a.path.split(':').length - b.path.split(':').length,
  )
  for (const [key, route] of candidates) {
    const { names, pattern } = compile(route.path)
    const found = pattern.exec(clean)
    if (!found) continue
    const params: Record<string, string> = {}
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(found[index + 1])
    })
    return { key, params }
  }
  return null
}

/**
 * Build a Studio URL. Only `site` and the route's declared query keys survive; anything else a
 * caller passes is dropped, so stale or foreign state never leaks into a shared link.
 */
export function buildHref(
  table: Record<string, WebsiteRoute>,
  base: string,
  key: string,
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
): string {
  const route = table[key]
  if (!route) throw new Error(`Unknown Website route ${key}`)
  const path = route.path.replace(/:(\w+)/g, (_, name: string) => {
    if (params[name] == null) throw new Error(`Website route ${key} needs ${name}`)
    return encodeURIComponent(params[name])
  })
  const allowed = new Set(['site', ...(route.query ?? [])])
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(query))
    if (allowed.has(name) && value != null && value !== '') search.set(name, String(value))
  const text = search.toString()
  return `${base}${path}${text ? `?${text}` : ''}`
}
