// The backend's own routes.
//
// One factory per path: the path is data, so composition can settle ownership and
// refuse two modules claiming the same one, while the handler is built at boot
// because it needs the running server.
//
// The frame these sit in belongs to `screen.ts`, which every other module uses too.

import { text, withHeaders } from '@ketvietlab/ketjs'
import type { MenuNode, Route, ServeContext } from '@ketvietlab/ketjs'

const firstPath = (nodes: MenuNode[]): string | null => {
  for (const node of nodes) {
    if (node.path && node.path !== '/admin') return node.path
    const child = firstPath(node.children)
    if (child) return child
  }
  return null
}

const admin =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const target = firstPath(await ctx.menu(url, req))
    return target
      ? withHeaders(text('', { status: 303 }), { location: target })
      : text('This deployment has no admin screen available.', { status: 404 })
  }

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/admin': admin,
}
