import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  code,
  dataTable,
  emptyState,
  framed,
  inline,
  linkButton,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'

const localized = (path: string, locale: string): string =>
  !locale ? path : path.includes('?') ? `${path}&${locale.slice(1)}` : `${path}${locale}`

export type CompanyRow = {
  id: string
  code: string
  name: string
  partnerId: string
  parentId?: string | null
  currency: string
  active: boolean
}

export type BranchRow = {
  id: string
  companyId: string
  code: string
  name: string
  parentId?: string | null
  isRoot?: boolean
  active: boolean
}

export const companiesScreen = (
  _: Translator,
  rows: CompanyRow[],
  frame: Frame,
  locale = '',
  includeArchived = false,
): TemplateResult =>
  framed(
    _,
    _('company_backend.screen.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('company_backend.action.create'),
          href: localized('/admin/companies/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('company_backend.action.hierarchy'),
          href: localized('/admin/companies/hierarchy', locale),
        }),
        linkButton({
          label: includeArchived
            ? _('company_backend.filter.activeOnly')
            : _('company_backend.filter.includeArchived'),
          href: localized(includeArchived ? '/admin/companies' : '/admin/companies?archived=1', locale),
          variant: 'tertiary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('company_backend.screen.empty'), _('company_backend.screen.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'name',
                label: _('company_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/companies/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
              },
              {
                key: 'code',
                label: _('company_backend.field.code'),
                kind: 'identifier',
                cell: (row) => code(row.code, 'identifier'),
              },
              { key: 'currency', label: _('company_backend.field.currency'), cell: (row) => row.currency },
              {
                key: 'state',
                label: _('company_backend.field.state'),
                kind: 'status',
                cell: (row) =>
                  badge(
                    row.active ? _('company_backend.state.active') : _('company_backend.state.archived'),
                    row.active ? 'positive' : 'neutral',
                  ),
              },
            ],
          }),
    ]),
  )

type CompanyFormOptions = {
  partners: FormOption[]
  parents: FormOption[]
  errors?: string[]
  branches?: BranchRow[]
}

const companyFields = (_: Translator, row: Partial<CompanyRow>, options: CompanyFormOptions) => [
  {
    name: 'partnerId',
    label: _('company_backend.field.partner'),
    type: 'select' as const,
    value: row.partnerId,
    options: [{ value: '', label: _('company_backend.option.selectPartner') }, ...options.partners],
    required: true,
  },
  { name: 'code', label: _('company_backend.field.code'), value: row.code, required: true },
  {
    name: 'currency',
    label: _('company_backend.field.currency'),
    value: row.currency ?? 'VND',
    required: true,
  },
  {
    name: 'parentId',
    label: _('company_backend.field.parent'),
    type: 'select' as const,
    value: row.parentId,
    options: [{ value: '', label: _('company_backend.option.noParent') }, ...options.parents],
  },
]

export const companyFormScreen = (
  _: Translator,
  row: Partial<CompanyRow> & { id?: string },
  options: CompanyFormOptions,
  frame: Frame,
  locale = '',
): TemplateResult => {
  const existing = !!row.id
  const branches = options.branches ?? []
  return framed(
    _,
    existing ? String(row.name ?? row.code) : _('company_backend.create.title'),
    frame,
    stack([
      ...(existing
        ? [
            section({
              title: _('company_backend.state.title'),
              body: surface({
                body: recordActions({
                  action: localized(`/admin/companies/${row.id}/archive`, locale),
                  actions: [
                    row.active
                      ? {
                          value: 'archive',
                          label: _('company_backend.action.archive'),
                          variant: 'destructive' as const,
                        }
                      : {
                          value: 'restore',
                          label: _('company_backend.action.restore'),
                          variant: 'secondary' as const,
                        },
                  ],
                }),
              }),
            }),
          ]
        : []),
      section({
        title: _('company_backend.detail.identity'),
        description: _('company_backend.detail.identityHint'),
        actions: existing
          ? linkButton({
              label: _('company_backend.action.manageAddress'),
              href: localized(`/admin/partners/${row.partnerId}`, locale),
              variant: 'secondary',
            })
          : undefined,
        body: surface({
          body: recordForm({
            action: localized(existing ? `/admin/companies/${row.id}` : '/admin/companies/new', locale),
            fields: companyFields(_, row, options),
            submit: _('company_backend.action.save'),
            submitVariant: 'primary',
            errors: options.errors,
            cancelHref: localized('/admin/companies', locale),
            cancelLabel: _('company_backend.action.cancel'),
          }),
        }),
      }),
      ...(existing
        ? [
            section({
              title: _('company_backend.branches.title'),
              description: _('company_backend.branches.hint'),
              actions: linkButton({
                label: _('company_backend.action.addBranch'),
                href: localized(`/admin/companies/${row.id}/branches/new`, locale),
                variant: 'primary',
              }),
              body:
                branches.length === 0
                  ? emptyState(_('company_backend.branches.empty'), _('company_backend.branches.emptyHint'))
                  : dataTable(_, {
                      rows: branches,
                      id: (branch) => branch.id,
                      columns: [
                        {
                          key: 'name',
                          label: _('company_backend.field.name'),
                          priority: 'primary',
                          cell: (branch) =>
                            branch.isRoot
                              ? branch.name
                              : linkButton({
                                  label: branch.name,
                                  href: localized(`/admin/branches/${branch.id}`, locale),
                                  variant: 'tertiary',
                                }),
                        },
                        {
                          key: 'code',
                          label: _('company_backend.field.code'),
                          cell: (branch) => code(branch.code, 'identifier'),
                        },
                        {
                          key: 'kind',
                          label: _('company_backend.field.kind'),
                          cell: (branch) =>
                            badge(
                              branch.isRoot
                                ? _('company_backend.branch.root')
                                : _('company_backend.branch.operational'),
                              branch.isRoot ? 'info' : 'neutral',
                            ),
                        },
                        {
                          key: 'state',
                          label: _('company_backend.field.state'),
                          cell: (branch) =>
                            badge(
                              branch.active
                                ? _('company_backend.state.active')
                                : _('company_backend.state.archived'),
                              branch.active ? 'positive' : 'neutral',
                            ),
                        },
                      ],
                    }),
            }),
          ]
        : []),
    ]),
  )
}

export const branchFormScreen = (
  _: Translator,
  company: CompanyRow,
  row: Partial<BranchRow> & { id?: string },
  parents: FormOption[],
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  const locale = options.locale ?? ''
  return framed(
    _,
    existing ? String(row.name) : _('company_backend.branch.createTitle'),
    frame,
    stack([
      ...(existing
        ? [
            section({
              title: _('company_backend.state.title'),
              body: surface({
                body: recordActions({
                  action: localized(`/admin/branches/${row.id}/archive`, locale),
                  actions: [
                    row.active
                      ? {
                          value: 'archive',
                          label: _('company_backend.action.archiveBranch'),
                          variant: 'destructive' as const,
                        }
                      : {
                          value: 'restore',
                          label: _('company_backend.action.restoreBranch'),
                          variant: 'secondary' as const,
                        },
                  ],
                }),
              }),
            }),
          ]
        : []),
      section({
        eyebrow: company.name,
        title: _('company_backend.branch.detail'),
        body: surface({
          body: recordForm({
            action: localized(
              existing ? `/admin/branches/${row.id}` : `/admin/companies/${company.id}/branches/new`,
              locale,
            ),
            fields: [
              { name: 'name', label: _('company_backend.field.name'), value: row.name, required: true },
              { name: 'code', label: _('company_backend.field.code'), value: row.code, required: true },
              {
                name: 'parentId',
                label: _('company_backend.field.branchParent'),
                type: 'select',
                value: row.parentId,
                options: parents,
                required: true,
              },
            ],
            hidden: { companyId: company.id },
            submit: _('company_backend.action.save'),
            submitVariant: 'primary',
            errors: options.errors,
            cancelHref: localized(`/admin/companies/${company.id}`, locale),
            cancelLabel: _('company_backend.action.cancel'),
          }),
        }),
      }),
    ]),
  )
}

export const hierarchyScreen = (
  _: Translator,
  rows: Array<CompanyRow & { depth: number; parentName?: string | null }>,
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('company_backend.hierarchy.title'),
    frame,
    rows.length === 0
      ? emptyState(_('company_backend.screen.empty'), _('company_backend.screen.emptyHint'))
      : dataTable(_, {
          rows,
          id: (row) => row.id,
          columns: [
            {
              key: 'name',
              label: _('company_backend.field.name'),
              priority: 'primary',
              cell: (row) =>
                inline([
                  '— '.repeat(row.depth),
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/companies/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
                ]),
            },
            { key: 'code', label: _('company_backend.field.code'), cell: (row) => code(row.code) },
            {
              key: 'parent',
              label: _('company_backend.field.parent'),
              cell: (row) => row.parentName ?? '—',
            },
          ],
        }),
  )

export const contextScreen = (
  _: Translator,
  options: {
    companies: Array<{ id: string; code: string; name: string }>
    branches: Array<{ id: string; companyId: string; code: string; name: string; isRoot?: boolean }>
    selectedCompanies: string[]
    selectedBranches: string[]
    companyId: string
    branchId: string
    errors?: string[]
  },
  frame: Frame,
  locale = '',
): TemplateResult => {
  const companyNames = new Map(options.companies.map((company) => [company.id, company.name]))
  const branchLabel = (branch: (typeof options.branches)[number]) =>
    `${companyNames.get(branch.companyId) ?? branch.companyId} / ${
      branch.isRoot ? `${_('company_backend.branch.root')} · ${branch.code}` : branch.name
    }`
  return framed(
    _,
    _('company_backend.context.title'),
    frame,
    stack([
      section({
        title: _('company_backend.context.writeTitle'),
        description: _('company_backend.context.writeHint'),
        body: surface({
          body: recordForm({
            action: localized('/admin/context', locale),
            fields: [
              {
                name: 'companyId',
                label: _('company_backend.context.activeCompany'),
                type: 'select',
                value: options.companyId,
                required: true,
                options: options.companies.map((company) => ({ value: company.id, label: company.name })),
              },
              {
                name: 'branchId',
                label: _('company_backend.context.activeBranch'),
                type: 'select',
                value: options.branchId,
                required: true,
                options: options.branches.map((branch) => ({
                  value: branch.id,
                  label: branchLabel(branch),
                })),
              },
              ...options.companies.map((company) => ({
                name: `company.${company.id}`,
                label: `${_('company_backend.context.readCompany')}: ${company.name}`,
                type: 'checkbox' as const,
                value: options.selectedCompanies.includes(company.id),
                span: 'half' as const,
              })),
              ...options.branches.map((branch) => ({
                name: `branch.${branch.id}`,
                label: `${_('company_backend.context.readBranch')}: ${branchLabel(branch)}`,
                type: 'checkbox' as const,
                value: options.selectedBranches.includes(branch.id),
                span: 'half' as const,
              })),
            ],
            submit: _('company_backend.context.apply'),
            submitVariant: 'primary',
            errors: options.errors,
          }),
        }),
      }),
    ]),
  )
}
