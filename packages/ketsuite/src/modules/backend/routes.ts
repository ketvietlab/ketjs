// The backend's own routes.
//
// One factory per path: the path is data, so composition can settle ownership and
// refuse two modules claiming the same one, while the handler is built at boot
// because it needs the running server. Dispatch checks the live manifest, so these
// stop answering the moment the module is switched off.
//
// The frame these sit in belongs to `screen.ts`, which every other module uses too.

import type { ServeContext, Route } from '@ketvietlab/ketjs'
import { appsScreen } from './screens.tsx'
import { adminPage } from './screen.ts'
import type { Req } from './screen.ts'

/**
 * The apps screen wants two joints nothing else does: a footer under the last
 * group, and a per-app slot beside Install/Remove. The card joint takes the app as
 * a prop, so it is rendered once per card here rather than by the screen — handing
 * the screen a function would have been shorter and would have made it depend on a
 * runtime, and the catalogue renders these same screens with no server at all.
 */
const apps =
  (ctx: ServeContext): Route =>
  async (url, req: Req) => {
    const rows = await ctx.appsOf(req)
    const perApp = Object.fromEntries(
      await Promise.all(
        rows.map(
          async (app) => [app.name, await ctx.joint(url, req, 'backend:app-card.actions', { app })] as const,
        ),
      ),
    )
    return adminPage(ctx, url, req, {
      title: 'KetSuite',
      translate: false,
      extras: {
        'apps.footer': await ctx.joint(url, req, 'backend:apps.footer'),
        'app-card.actions': perApp,
      },
      body: (_, frame) => appsScreen(_, rows, frame),
    })
  }

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/admin': apps,
  '/admin/apps': apps,
}

export { frameOf, timezoneOf, viewerOf } from './screen.ts'
