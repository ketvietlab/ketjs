import type { MenuDef } from 'ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.companies': {
    parent: 'admin.config',
    label: 'menu.companies',
    path: '/admin/companies',
    needs: 'company.listCompanies',
    sequence: 20,
  },
  'admin.companyHierarchy': {
    parent: 'admin.config',
    label: 'menu.hierarchy',
    path: '/admin/companies/hierarchy',
    needs: 'company.listCompanies',
    sequence: 30,
  },
}
