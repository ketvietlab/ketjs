import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormPage, RecordForm, Section, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type ContextCompany = { id: string; code: string; name: string }
export type ContextBranch = {
  id: string
  companyId: string
  code: string
  name: string
  isRoot?: boolean
}

export type ContextFormValues = {
  selectedCompanies: readonly string[]
  selectedBranches: readonly string[]
  companyId: string
  branchId: string
}

export type ContextScreenOptions = ContextFormValues & {
  companies: readonly ContextCompany[]
  branches: readonly ContextBranch[]
  action: string
  errors?: readonly string[]
}

export const contextFields = (_: Translator, options: ContextScreenOptions): FormField[] => {
  const companyNames = new Map(options.companies.map((company) => [company.id, company.name]))
  const branchLabel = (branch: ContextBranch) =>
    `${companyNames.get(branch.companyId) ?? branch.companyId} / ${
      branch.isRoot ? `${_('company_backend.branch.root')} · ${branch.code}` : branch.name
    }`
  return [
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
      options: options.branches.map((branch) => ({ value: branch.id, label: branchLabel(branch) })),
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
  ]
}

export const contextScreen = (
  _: Translator,
  frame: Frame,
  options: ContextScreenOptions,
): TemplateResult => {
  const formId = 'working-context-form'
  return shell(
    _,
    _('company_backend.context.title'),
    <FormPage
      scope="working-context-page"
      title={_('company_backend.context.title')}
      description={_('company_backend.context.writeHint')}
      actions={button({
        label: _('company_backend.context.apply'),
        type: 'submit',
        form: formId,
        variant: 'primary',
      })}
      body={
        <Section
          title={_('company_backend.context.writeTitle')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="working-context"
                  action={options.action}
                  hidden={{ action: 'save' }}
                  fields={contextFields(_, options)}
                  errors={options.errors}
                  submit={_('company_backend.context.apply')}
                  submitVariant="primary"
                  submitPlacement="external"
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false },
  )
}
