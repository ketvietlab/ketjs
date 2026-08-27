import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  code,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  linkButton,
  RecordActions,
  RecordForm,
  RecordMore,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, FormOption, Frame } from '../../../ui/index.ts'
import type { BranchRow, CompanyRow } from './types.ts'

export type CompanyFormValues = Partial<CompanyRow> & { id?: string }

export type CompanyFormScreenOptions = {
  mode: 'create' | 'detail'
  action: string
  cancelHref: string
  partners: readonly FormOption[]
  parents: readonly FormOption[]
  errors?: readonly string[]
  branches?: readonly BranchRow[]
  archiveAction?: string
  manageAddressHref?: string
  addBranchHref?: string
  branchHref?: (branch: BranchRow) => string
  collaboration?: JSXChild
  returnTo?: string
}

const withRejectedOption = (
  options: readonly FormOption[],
  value: unknown,
): readonly FormOption[] => {
  const selected = String(value ?? '')
  return selected && !options.some((option) => option.value === selected)
    ? [{ value: selected, label: selected }, ...options]
    : options
}

export const companyFields = (
  _: Translator,
  values: CompanyFormValues,
  options: Pick<CompanyFormScreenOptions, 'partners' | 'parents'>,
): FormField[] => [
  {
    name: 'partnerId',
    label: _('company_backend.field.partner'),
    type: 'select',
    value: values.partnerId,
    options: [
      { value: '', label: _('company_backend.option.selectPartner') },
      ...withRejectedOption(options.partners, values.partnerId),
    ],
    required: true,
  },
  { name: 'code', label: _('company_backend.field.code'), value: values.code, required: true },
  {
    name: 'currency',
    label: _('company_backend.field.currency'),
    value: values.currency ?? 'VND',
    required: true,
  },
  {
    name: 'parentId',
    label: _('company_backend.field.parent'),
    type: 'select',
    value: values.parentId,
    options: [
      { value: '', label: _('company_backend.option.noParent') },
      ...withRejectedOption(options.parents, values.parentId),
    ],
  },
]

export const companyFormScreen = (
  _: Translator,
  values: CompanyFormValues,
  options: CompanyFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const detail = options.mode === 'detail'
  const branches = options.branches ?? []
  const title = detail
    ? String(values.name ?? values.code ?? values.id)
    : _('company_backend.create.title')
  const formId = 'company-record-form'
  const hidden = {
    action: 'save',
    ...(values.id ? { id: values.id } : {}),
    ...(detail && values.version != null ? { expectedVersion: String(values.version) } : {}),
    ...(options.returnTo ? { returnTo: options.returnTo } : {}),
  }
  const archive =
    detail && options.archiveAction ? (
      <RecordActions
        action={options.archiveAction}
        hidden={{
          ...(values.version != null ? { expectedVersion: String(values.version) } : {}),
          ...(options.returnTo ? { returnTo: options.returnTo } : {}),
        }}
        actions={[
          values.active
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
    ) : null

  const body = stack([
    <Section
      title={_('company_backend.detail.identity')}
      description={_('company_backend.detail.identityHint')}
      actions={
        detail && options.manageAddressHref
          ? linkButton({
              label: _('company_backend.action.manageAddress'),
              href: options.manageAddressHref,
              variant: 'secondary',
            })
          : undefined
      }
      body={
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="company-record"
              action={options.action}
              hidden={hidden}
              fields={companyFields(_, values, options)}
              errors={options.errors}
              submit={_('company_backend.action.save')}
              submitVariant="primary"
              submitPlacement="external"
            />
          }
        />
      }
    />,
    ...(detail
      ? [
          <Section
            title={_('company_backend.branches.title')}
            description={_('company_backend.branches.hint')}
            actions={
              options.addBranchHref
                ? linkButton({
                    label: _('company_backend.action.addBranch'),
                    href: options.addBranchHref,
                    variant: 'primary',
                  })
                : undefined
            }
            body={
              branches.length === 0
                ? emptyState(
                    _('company_backend.branches.empty'),
                    _('company_backend.branches.emptyHint'),
                  )
                : dataTable(_, {
                    rows: branches,
                    id: (branch) => branch.id,
                    columns: [
                      {
                        key: 'name',
                        label: _('company_backend.field.name'),
                        priority: 'primary',
                        cell: (branch) =>
                          branch.isRoot || !options.branchHref
                            ? branch.name
                            : linkButton({
                                label: branch.name,
                                href: options.branchHref(branch),
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
                        kind: 'status',
                        cell: (branch) =>
                          branch.active
                            ? badge(_('company_backend.state.active'), 'positive', 'active')
                            : badge(_('company_backend.state.archived'), 'neutral', 'archived'),
                      },
                    ],
                  })
            }
          />,
        ]
      : []),
  ])

  return shell(
    _,
    title,
    <FormPage
      scope="company-form-page"
      title={title}
      description={
        detail
          ? `${String(values.code ?? '')} · ${String(values.currency ?? '')}`
          : _('company_backend.detail.identityHint')
      }
      status={
        detail
          ? values.active
            ? badge(_('company_backend.state.active'), 'positive', 'active')
            : badge(_('company_backend.state.archived'), 'neutral', 'archived')
          : undefined
      }
      actions={
        <FormCluster
          label={_('company_backend.action.actions')}
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
                    body={
                      <FormCluster label={_('company_backend.action.more')} forms={[archive]} />
                    }
                  />,
                ]
              : []),
          ]}
        />
      }
      body={body}
      aside={detail ? options.collaboration : undefined}
      asideLabel={_('company_backend.collaboration.label')}
    />,
    { ...frame, topbar: false, titled: false },
  )
}
