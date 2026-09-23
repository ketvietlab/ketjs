// What every public KetSuite product deployment shares.
//
// The arrays are authoring conveniences, not framework metadata: spreading one
// into a DeploymentSpec is identical to writing each module out. The split into
// products follows the private Két Việt deployments (commerce, hospitality,
// office) with their private modules left out, so a product is a failure and
// release boundary here the same way it is there: its own datastore, its own
// modules and its own roles.

import { sqliteStore } from '@ketvietlab/ketjs'
import type {
  ModulePermissionsDef,
  ModuleRef,
  OpenStore,
  RoleTemplateDef,
  ServeSpec,
} from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import backend from '../modules/backend/index.ts'

export const staffChannelModules = [suite.channelApi, suite.hr, suite.attendance, suite.accountStaffChannel]

export const commonBusinessModules = [
  suite.website,
  ...staffChannelModules,
  suite.address,
  suite.partner,
  suite.company,
  suite.user,
  suite.oauth,
  suite.storage,
  suite.mail,
  suite.mailStaffChannel,
  suite.mailBackend,
  suite.mailTransport,
  suite.activity,
  suite.calendar,
  suite.uom,
  suite.product,
  suite.productMedia,
  suite.productBackend,
  suite.productMailBackend,
  suite.stock,
  suite.stockStaffChannel,
  suite.inventoryStaffChannel,
  suite.sale,
  suite.saleStaffChannel,
  backend,
  suite.userBackend,
  suite.oauthBackend,
  suite.stockBackend,
  suite.stockMailBackend,
  suite.saleBackend,
  suite.partnerBackend,
  suite.partnerMailBackend,
]

const moduleName = (module: ModuleRef) => (typeof module === 'string' ? module : module.name)

/**
 * The permission declarations of exactly the modules a product composes, with
 * that product's roles. Coverage is required: a function of a composed module
 * that no bundle or exemption accounts for fails the build instead of being
 * callable by nobody, or by anybody.
 */
export function productPermissions(
  modules: ModuleRef[],
  roleTemplates: Record<string, RoleTemplateDef>,
): {
  requireCoverage: true
  modules: Record<string, ModulePermissionsDef>
  roleTemplates: typeof roleTemplates
} {
  const catalogue: Record<string, ModulePermissionsDef> = suite.ketsuitePermissionModules
  const names = [...new Set(modules.map(moduleName))].sort()
  return {
    requireCoverage: true,
    modules: Object.fromEntries(
      names.map((name) => {
        const declaration = catalogue[name]
        if (!declaration) throw new Error(`missing permission declaration for module "${name}"`)
        return [name, declaration]
      }),
    ),
    roleTemplates,
  }
}

/** The request handling every product serves with; each adds its store and defaults. */
export const productServe = (openStore: OpenStore = sqliteStore) =>
  ({
    openStore,
    sessions: { anonymous: { company: 'default' } },
    resolveSession: suite.resolveUserSession,
    resolveAudience: (url, req) => {
      const authorization = String(req.headers.authorization ?? '')
      const cookies = String(req.headers.cookie ?? '')
      if (/^Bearer\s+/i.test(authorization))
        return url.pathname.startsWith('/api/staff/v1/') ? 'staff' : 'customer'
      return /(?:^|;\s*)ket_customer_session=/.test(cookies) ? 'customer' : 'anonymous'
    },
    permissions: (ctx, userId, url, req) =>
      ctx
        .callUnchecked('user.permitted', { userId }, url, req)
        .then((result) =>
          (result as { superuser: boolean; functions?: string[] }).superuser
            ? null
            : (result as { functions: string[] }).functions,
        ),
    pages: {
      siteResolve: 'website.resolveSite',
      resolve: 'website.getEntryByPath',
      // Minting a preview link was the whole feature until now: nothing
      // served one, so the token went into a chat and opened nothing.
      previewResolve: 'website.previewEntry',
      region: 'website.page',
      notFound: 'website.page.notFound',
      siteTitle: 'KetSuite',
    },
  }) satisfies Partial<ServeSpec>

/** Local defaults for a product: its own SQLite file, Vietnamese first. */
export const productDefaults = (name: string) => ({
  sqliteFile: `.ket/${name}.db`,
  defaultLocale: 'vi',
  fallbackLocale: 'vi',
  defaultTimezone: 'Asia/Ho_Chi_Minh',
})

export const productQueues = { default: 10, maintenance: 2, mail: 5, media: 2 }
