import { NavList, Section, Stack, Text } from '@ketvietlab/design-system'
import { text, withHeaders } from '@ketvietlab/ketjs'
import type { MenuNode, Route, ServeContext } from '@ketvietlab/ketjs'
import { workspaceScreen } from '../../ui/layout.tsx'
import { adminPage, inLocale } from './screen.ts'

type Result = { label: string; href: string }
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase()
const menuResults = (nodes: MenuNode[], query: string, ancestors: string[] = []): Result[] =>
  nodes.flatMap((node) => {
    const labels = [...ancestors, node.label]
    return [
      ...(node.path && normalized(labels.join(' ')).includes(query)
        ? [{ label: labels.join(' / '), href: node.path }]
        : []),
      ...menuResults(node.children, query, labels),
    ]
  })

// Providers use the same checked, company-scoped functions as their collection.
// Missing modules and disallowed screens never run a record query.
const providers = [
  {
    label: 'products',
    fn: 'product.listTemplates',
    path: '/admin/product/templates',
    href: (id: string) => `/admin/product/templates?record=${encodeURIComponent(`product.template:${id}`)}`,
  },
  {
    label: 'partners',
    fn: 'partner.listPartners',
    path: '/admin/partner/partners',
    href: (id: string) => `/admin/partner/partners/${encodeURIComponent(id)}`,
  },
] as const

export const globalSearch =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (!(await ctx.requestIdentityOf(url, req)))
      return withHeaders(text('', { status: 303 }), { location: '/login' })
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
    const menuUrl = new URL(url)
    menuUrl.searchParams.delete('menu')
    const menu = await ctx.menu(menuUrl, req)
    const available = menuResults(menu, '')
    const sections: { label: string; items: Result[]; failed?: boolean }[] = []
    if (query) {
      sections.push({
        label: 'menus',
        items: menuResults(menu, normalized(query))
          .slice(0, 20)
          .map((item) => ({ ...item, href: inLocale(url, item.href) })),
      })
      const live = await ctx.live(req)
      for (const provider of providers) {
        if (
          !live.functions[provider.fn] ||
          !available.some((item) => item.href.split('?')[0] === provider.path) ||
          !(await ctx.allows(provider.fn, url, req))
        )
          continue
        try {
          const rows = (await ctx.call(provider.fn, { search: query, limit: 8 }, url, req)) as {
            id: string
            name: string
          }[]
          sections.push({
            label: provider.label,
            items: rows.map((row) => ({ label: row.name, href: inLocale(url, provider.href(row.id)) })),
          })
        } catch {
          sections.push({ label: provider.label, items: [], failed: true })
        }
      }
    }
    return adminPage(ctx, url, req, {
      title: 'backend.globalSearch.label',
      body: (_, frame) =>
        workspaceScreen({
          translator: _,
          frame: { ...frame, globalSearchQuery: query },
          title: _('backend.globalSearch.label'),
          body: (
            <Stack
              items={
                query
                  ? sections.map((section) => (
                      <Section
                        title={_(`backend.globalSearch.${section.label}`)}
                        body={
                          section.items.length ? (
                            <NavList
                              label={_(`backend.globalSearch.${section.label}`)}
                              items={section.items}
                            />
                          ) : (
                            <Text tone="muted">
                              {_(
                                section.failed ? 'backend.globalSearch.failed' : 'backend.globalSearch.empty',
                              )}
                            </Text>
                          )
                        }
                      />
                    ))
                  : [<Text tone="muted">{_('backend.globalSearch.hint')}</Text>]
              }
            />
          ),
        }),
    })
  }
