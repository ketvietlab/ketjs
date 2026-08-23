import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  emptyState,
  Framed,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type Row = Record<string, unknown>

/**
 * Where the answer to "which account" is kept, so a document stops asking.
 *
 * Two levels, narrowest first: a product category decides revenue and expense
 * for what it holds, and the company decides the rest. Receivable and payable
 * can also be set per partner, on the partner's own accounting screen — this
 * page says so rather than duplicating the control.
 */
export const accountDefaultsScreen = (
  _: Translator,
  options: {
    frame: Frame
    action: string
    categoryAction: string
    defaultsFields: FormField[]
    categoryFields?: FormField[]
    rows: Row[]
    accountLabel: (id: unknown) => string
    editing?: Row | null
    categorySubmit?: string
    categoryHref?: (row: Row) => string
    cancelHref?: string
    errors?: string[]
    categoryErrors?: string[]
  },
): TemplateResult => {
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

  return (
    <Framed
      translator={_}
      title={_('account_backend.defaults.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.defaults.kicker')}
          title={_('account_backend.defaults.title')}
          subtitle={_('account_backend.defaults.subtitle')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            {
              id: 'categories',
              label: _('account_backend.defaults.summary.categories'),
              value: options.rows.length,
            },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.defaults.company.title')}
                description={_('account_backend.defaults.company.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="account-defaults-form"
                        scope="account-defaults"
                        action={options.action}
                        submit={_('account_backend.action.save')}
                        submitVariant="primary"
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
                          padding="compact"
                          body={
                            <RecordForm
                              id="account-category-form"
                              scope="account-category"
                              action={options.categoryAction}
                              submit={options.categorySubmit ?? _('account_backend.action.create')}
                              submitVariant="secondary"
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
        />
      }
    />
  )
}
