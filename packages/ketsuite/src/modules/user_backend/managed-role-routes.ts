import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { rowListSearch } from '../backend/row-list.ts'
import { recordModalHref } from '../../ui/record-modal.tsx'
import { rolesScreen } from './screens/roles-list.tsx'
import type { RoleRow } from './screens/types.ts'
import { roleListSearch } from './search.ts'

export const managedRoleRoutes: Record<string, RouteEntry> = {
  '/admin/roles':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const roles = (await ctx.call('user.listRoles', {}, url, req)) as RoleRow[]
      return adminPage(ctx, url, req, {
        title: 'user_backend.roles.title',
        active: '/admin/roles',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: roleListSearch,
            rows: roles
              .filter((row) => row.mode === 'managed')
              .map((row) => ({
                ...row,
                detailHref: recordModalHref(url, { kind: 'user.role', id: row.id }),
              })),
            frame,
            name: 'user-roles-filter',
            bodyId: 'user-roles-list',
            functions: {
              apply: 'user_backend.applySearchFilter',
              saveFavorite: 'user_backend.saveSearchFavorite',
              deleteFavorite: 'user_backend.deleteSearchFavorite',
              setDefaultFavorite: 'user_backend.setDefaultSearchFavorite',
            },
            labels: { searchPlaceholder: _('user_backend.search.roles') },
          })
          return rolesScreen(_, search.frame, {
            rows: search.rows,
            table: { groups: search.groups },
            createHref: null,
          })
        },
      })
    },
}
