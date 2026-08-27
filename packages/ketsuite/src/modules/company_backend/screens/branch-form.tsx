import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  linkButton,
  RecordActions,
  RecordForm,
  RecordMore,
  Section,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, FormOption, Frame } from '../../../ui/index.ts'
import type { BranchRow, CompanyRow } from './types.ts'

export type BranchFormValues = Partial<BranchRow> & { id?: string }

export type BranchFormScreenOptions = {
  mode: 'create' | 'detail'
  action: string
  cancelHref: string
  parents: readonly FormOption[]
  errors?: readonly string[]
  archiveAction?: string
}

const withSelectedParent = (parents: readonly FormOption[], value: unknown): readonly FormOption[] => {
  const selected = String(value ?? '')
  return selected && !parents.some((option) => option.value === selected)
    ? [{ value: selected, label: selected }, ...parents]
    : parents
}

export const branchFields = (
  _: Translator,
  values: BranchFormValues,
  parents: readonly FormOption[],
): FormField[] => [
  { name: 'name', label: _('company_backend.field.name'), value: values.name, required: true },
  { name: 'code', label: _('company_backend.field.code'), value: values.code, required: true },
  {
    name: 'parentId',
    label: _('company_backend.field.branchParent'),
    type: 'select',
    value: values.parentId,
    options: withSelectedParent(parents, values.parentId),
    required: true,
  },
]

export const branchFormScreen = (
  _: Translator,
  company: CompanyRow,
  values: BranchFormValues,
  options: BranchFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const detail = options.mode === 'detail'
  const title = detail
    ? String(values.name ?? values.code ?? values.id)
    : _('company_backend.branch.createTitle')
  const formId = 'branch-record-form'
  const archive =
    detail && options.archiveAction ? (
      <RecordActions
        action={options.archiveAction}
        actions={[
          values.active
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
    ) : null

  return shell(
    _,
    title,
    <FormPage
      scope="branch-form-page"
      title={title}
      description={`${company.name} · ${company.code} · ${_('company_backend.branch.operational')}`}
      status={
        detail
          ? values.active
            ? badge(_('company_backend.state.active'), 'positive', 'active')
            : badge(_('company_backend.state.archived'), 'neutral', 'archived')
          : undefined
      }
      actions={
        <FormCluster
          label={_('company_backend.action.branchActions')}
          forms={[
            button({
              label: _('company_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('company_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
            ...(archive
              ? [
                  <RecordMore
                    label={_('company_backend.action.more')}
                    body={<FormCluster label={_('company_backend.action.more')} forms={[archive]} />}
                  />,
                ]
              : []),
          ]}
        />
      }
      body={
        <Section
          title={_('company_backend.branch.detail')}
          description={_('company_backend.branch.detailHint')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="branch-record"
                  action={options.action}
                  hidden={{ action: 'save', companyId: company.id, ...(values.id ? { id: values.id } : {}) }}
                  fields={branchFields(_, values, options.parents)}
                  errors={options.errors}
                  submit={_('company_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
