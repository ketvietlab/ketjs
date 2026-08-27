import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { Framed, RecordForm, Section, stack, Surface } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'

export type { BranchRow, CompanyRow } from './screens/index.ts'

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
