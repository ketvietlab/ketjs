import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
  dataTable,
  emptyState,
  Framed,
  inline,
  linkButton,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'
import type { BranchRow, CompanyRow } from './screens/index.ts'

export type { BranchRow, CompanyRow } from './screens/index.ts'

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
  return (
    <Framed
      translator={_}
      title={existing ? String(row.name ?? row.code) : _('company_backend.create.title')}
      frame={frame}
      body={stack([
        ...(existing
          ? [
              <Section
                title={_('company_backend.state.title')}
                body={
                  <Surface
                    body={
                      <RecordActions
                        action={localized(`/admin/companies/${row.id}/archive`, locale)}
                        actions={[
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
                        ]}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        <Section
          title={_('company_backend.detail.identity')}
          description={_('company_backend.detail.identityHint')}
          actions={
            existing
              ? linkButton({
                  label: _('company_backend.action.manageAddress'),
                  href: localized(`/admin/partner/partners/${row.partnerId}`, locale),
                  variant: 'secondary',
                })
              : undefined
          }
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(existing ? `/admin/companies/${row.id}` : '/admin/companies/new', locale)}
                  fields={companyFields(_, row, options)}
                  submit={_('company_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={localized('/admin/companies', locale)}
                  cancelLabel={_('company_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Section
                title={_('company_backend.branches.title')}
                description={_('company_backend.branches.hint')}
                actions={linkButton({
                  label: _('company_backend.action.addBranch'),
                  href: localized(`/admin/companies/${row.id}/branches/new`, locale),
                  variant: 'primary',
                })}
                body={
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
                                    href: localized(
                                      `/admin/companies/${row.id}/branches/${branch.id}`,
                                      locale,
                                    ),
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
                      })
                }
              />,
            ]
          : []),
      ])}
    />
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
  return (
    <Framed
      translator={_}
      title={existing ? String(row.name) : _('company_backend.branch.createTitle')}
      frame={frame}
      body={stack([
        ...(existing
          ? [
              <Section
                title={_('company_backend.state.title')}
                body={
                  <Surface
                    body={
                      <RecordActions
                        action={localized(
                          `/admin/companies/${company.id}/branches/${row.id}/archive`,
                          locale,
                        )}
                        actions={[
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
                        ]}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        <Section
          eyebrow={company.name}
          title={_('company_backend.branch.detail')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(
                    existing
                      ? `/admin/companies/${company.id}/branches/${row.id}`
                      : `/admin/companies/${company.id}/branches/new`,
                    locale,
                  )}
                  fields={[
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
                  ]}
                  hidden={{ companyId: company.id }}
                  submit={_('company_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={localized(`/admin/companies/${company.id}`, locale)}
                  cancelLabel={_('company_backend.action.cancel')}
                />
              }
            />
          }
        />,
      ])}
    />
  )
}

export const hierarchyScreen = (
  _: Translator,
  rows: Array<CompanyRow & { depth: number; parentName?: string | null }>,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <Framed
    translator={_}
    title={_('company_backend.hierarchy.title')}
    frame={frame}
    body={
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
          })
    }
  />
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
  return (
    <Framed
      translator={_}
      title={_('company_backend.context.title')}
      subtitle={_('company_backend.app.summary')}
      frame={frame}
      body={stack([
        <Section
          title={_('company_backend.context.writeTitle')}
          description={_('company_backend.context.writeHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized('/admin/context', locale)}
                  fields={[
                    {
                      name: 'companyId',
                      label: _('company_backend.context.activeCompany'),
                      type: 'select',
                      value: options.companyId,
                      required: true,
                      options: options.companies.map((company) => ({
                        value: company.id,
                        label: company.name,
                      })),
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
                  ]}
                  submit={_('company_backend.context.apply')}
                  submitVariant="primary"
                  errors={options.errors}
                />
              }
            />
          }
        />,
      ])}
    />
  )
}
