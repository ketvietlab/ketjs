import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  code,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  icon,
  linkButton,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type AccountDefaultRow = Record<string, unknown>

export type AccountDefaultsScreenOptions = {
  frame: Frame
  action: string
  categoryAction: string
  defaultsFields: FormField[]
  categoryFields?: FormField[]
  rows: AccountDefaultRow[]
  accountLabel: (id: unknown) => string
  editing?: AccountDefaultRow | null
  categorySubmit?: string
  categoryHref?: (row: AccountDefaultRow) => string
  cancelHref?: string
  errors?: string[]
  categoryErrors?: string[]
}

/**
 * Where the answer to "which account" is kept, so a document stops asking.
 *
 * Company defaults and product-category overrides have separate forms because
 * they are separate writes. The FormPage still gives the stable route one clear
 * identity and keeps the company save action beside that identity.
 */
export const accountDefaultsScreen = (
  _: Translator,
  options: AccountDefaultsScreenOptions,
): TemplateResult => {
  const defaultsFormId = 'account-defaults-form'
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      rowHref: options.categoryHref,
      columns: [
        {
          key: 'category',
          label: _('account_backend.field.categoryId'),
          priority: 'primary',
          width: 'wide',
          cell: (row) => String(row.categoryName ?? row.categoryId),
        },
        {
          key: 'income',
          label: _('account_backend.field.incomeAccountId'),
          cell: (row) => (row.incomeAccountId ? code(options.accountLabel(row.incomeAccountId)) : '—'),
        },
        {
          key: 'expense',
          label: _('account_backend.field.expenseAccountId'),
          cell: (row) => (row.expenseAccountId ? code(options.accountLabel(row.expenseAccountId)) : '—'),
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        _('account_backend.defaults.categories.empty'),
        _('account_backend.defaults.categories.emptyHint'),
        { icon: icon('notebook-tabs') },
      )}
    />
  )

  return shell(
    _,
    _('account_backend.defaults.title'),
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="account-defaults-form-page"
      title={_('account_backend.defaults.title')}
      description={_('account_backend.defaults.subtitle')}
      status={badge(
        `${_('account_backend.defaults.summary.categories')}: ${String(options.rows.length)}`,
        'neutral',
      )}
      actions={
        <FormCluster
          label={_('account_backend.defaults.company.title')}
          forms={[
            button({
              label: _('account_backend.action.save'),
              type: 'submit',
              form: defaultsFormId,
              variant: 'primary',
            }),
          ]}
        />
      }
      body={stack(
        [
          <Section
            title={_('account_backend.defaults.company.title')}
            description={_('account_backend.defaults.company.hint')}
            body={
              <Surface
                body={
                  <RecordForm
                    id={defaultsFormId}
                    scope="account-defaults"
                    action={options.action}
                    submit={_('account_backend.action.save')}
                    submitVariant="primary"
                    submitPlacement="external"
                    fields={options.defaultsFields}
                    errors={options.errors}
                  />
                }
              />
            }
          />,
          ...(options.categoryFields
            ? [
                <Section
                  title={
                    options.editing
                      ? _('account_backend.defaults.category.edit.title')
                      : _('account_backend.defaults.category.title')
                  }
                  description={_('account_backend.defaults.category.hint')}
                  actions={
                    options.editing && options.cancelHref
                      ? linkButton({
                          label: _('account_backend.action.cancelEdit'),
                          href: options.cancelHref,
                        })
                      : undefined
                  }
                  body={
                    <Surface
                      body={
                        <RecordForm
                          id="account-category-form"
                          scope="account-category"
                          action={options.categoryAction}
                          submit={options.categorySubmit ?? _('account_backend.action.create')}
                          submitVariant="secondary"
                          hidden={{ action: 'category' }}
                          fields={options.categoryFields}
                          errors={options.categoryErrors}
                        />
                      }
                    />
                  }
                />,
              ]
            : []),
          <Section
            title={_('account_backend.defaults.categories.title')}
            description={_('account_backend.defaults.categories.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
