import { text } from '@ketvietlab/ketjs'
import type { Row, RouteEntry, ServeContext, Route } from '@ketvietlab/ketjs'
import { rowListSearch } from '../backend/row-list.ts'
import { accessPolicyListSearch } from './search.ts'
import { adminPage } from '../backend/screen.ts'
import { recordModalCreateHref, recordModalHref } from '../../ui/record-modal.tsx'
import { accessPoliciesScreen } from './screens/access-policies-list.tsx'
import type { AccessPolicyMatchKind } from './screens/access-policies-list.tsx'

export const accessPolicyRoutes: Record<string, RouteEntry> = {
  '/admin/access-policies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      if (!(await ctx.allows('user.listAccessPolicies', url, req))) return text('Forbidden', { status: 403 })
      const [policies, roles, companies] = await Promise.all([
        ctx.call('user.listAccessPolicies', {}, url, req) as Promise<Row[]>,
        ctx.call('user.listRoles', {}, url, req) as Promise<Row[]>,
        ctx.call('company.listCompanies', {}, url, req) as Promise<Row[]>,
      ])
      const roleNames = new Map(roles.map((row) => [String(row.id), String(row.name)]))
      const companyNames = new Map(companies.map((row) => [String(row.id), String(row.name)]))
      const canCreate = await ctx.allows('user.saveAccessPolicy', url, req)
      return adminPage(ctx, url, req, {
        title: 'user_backend.policy.title',
        active: '/admin/access-policies',
        body: async (_, frame) => {
          const rows = policies.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            active: row.active === true,
            match: {
              kind: row.matchKind as AccessPolicyMatchKind,
              value: String(row.matchLabel ?? row.matchValue),
            },
            grants: (row.roleIds as string[]).map((id) => ({
              roleName: roleNames.get(id) ?? id,
              scope:
                row.scopeKind === 'tenant'
                  ? _('user_backend.scope.tenant')
                  : [
                      row.companyLabel ?? companyNames.get(String(row.companyId)),
                      row.scopeKind === 'branch' ? row.branchLabel : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
            })),
            memberCount: Number(row.memberCount ?? 0),
            detailHref: recordModalHref(url, {
              kind: 'user.accessPolicy',
              id: String(row.id),
              tab: 'rule',
            }),
          }))
          const search = await rowListSearch(ctx, url, req, {
            spec: accessPolicyListSearch,
            rows,
            frame,
            name: 'user-policy-filter',
            bodyId: 'user-policy-list',
            functions: {
              apply: 'user_backend.applySearchFilter',
              saveFavorite: 'user_backend.saveSearchFavorite',
              deleteFavorite: 'user_backend.deleteSearchFavorite',
              setDefaultFavorite: 'user_backend.setDefaultSearchFavorite',
            },
            labels: { searchPlaceholder: _('user_backend.search.policies') },
            groupLabel: (_key, value) => _(`user_backend.policy.match.${String(value)}`),
          })
          return accessPoliciesScreen(_, search.frame, {
            rows: search.rows,
            total: search.rows.length,
            table: { groups: search.groups },
            createHref: canCreate ? recordModalCreateHref(url, { kind: 'user.accessPolicy' }) : null,
          })
        },
      })
    },
}
