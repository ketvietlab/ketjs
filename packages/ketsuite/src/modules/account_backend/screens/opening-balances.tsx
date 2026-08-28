import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  FormPage,
  formatMoney,
  Framed,
  icon,
  LinkButton,
  ListPage,
  RecordForm,
  RecordWorkspace,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

type Row = Record<string, unknown>

const stateBadge = (_: Translator, state: unknown) => {
  const value = String(state)
  return badge(
    _(`account_backend.wave1.state.${value}`),
    value === 'posted' ? 'positive' : value === 'validated' ? 'info' : 'neutral',
    value,
  )
}

export const openingBalancesListScreen = (
  _: Translator,
  options: { frame: Frame; rows: Row[]; createHref: string; rowHref: (row: Row) => string },
): TemplateResult =>
  shell(
    _,
    _('account_backend.opening.title'),
    <ListPage
      title={_('account_backend.opening.title')}
      description={_('account_backend.opening.subtitle')}
      actions={
        <LinkButton label={_('account_backend.opening.create')} href={options.createHref} variant="primary" />
      }
      status={`${_('account_backend.opening.summary')}: ${String(options.rows.length)}`}
      body={
        options.rows.length ? (
          dataTable(_, {
            rows: options.rows,
            id: (row) => String(row.id),
            rowHref: options.rowHref,
            columns: [
              {
                key: 'date',
                label: _('account_backend.field.accountingDate'),
                priority: 'primary',
                cell: (row) => String(row.accountingDate),
              },
              {
                key: 'state',
                label: _('account_backend.field.state'),
                kind: 'status',
                cell: (row) => stateBadge(_, row.state),
              },
              {
                key: 'lines',
                label: _('account_backend.opening.lines'),
                cell: (row) => String(row.lineCount ?? '—'),
                align: 'end',
              },
              {
                key: 'debit',
                label: _('account_backend.field.debit'),
                cell: (row) => formatMoney(_, row.controlDebit, row.currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'checksum',
                label: _('account_backend.opening.source'),
                cell: (row) => code(String(row.sourceChecksum).slice(0, 12)),
              },
            ],
          })
        ) : (
          <Surface
            padding="compact"
            body={emptyState(_('account_backend.opening.empty'), _('account_backend.opening.emptyHint'), {
              icon: icon('notebook-tabs'),
            })}
          />
        )
      }
    />,
    { ...options.frame, chrome: null, topbar: false },
  )

export const openingBalanceImportScreen = (
  _: Translator,
  options: { frame: Frame; action: string; cancelHref: string; fields: FormField[]; errors?: string[] },
): TemplateResult =>
  shell(
    _,
    _('account_backend.opening.create'),
    <FormPage
      scope="opening-balance-import"
      title={_('account_backend.opening.create')}
      description={_('account_backend.opening.createHint')}
      body={
        <Surface
          body={
            <RecordForm
              id="opening-balance-form"
              scope="opening-balance"
              action={options.action}
              submit={_('account_backend.opening.validate')}
              submitVariant="primary"
              fields={options.fields}
              errors={options.errors}
            />
          }
        />
      }
    />,
    { ...options.frame, topbar: false },
  )

export const openingBalanceDetailScreen = (
  _: Translator,
  options: { frame: Frame; batch: Row; lines: Row[]; action: string; currency: unknown; entryHref?: string },
): TemplateResult => (
  <Framed
    translator={_}
    title={`${_('account_backend.opening.batch')} ${String(options.batch.accountingDate)}`}
    frame={options.frame}
    body={
      <RecordWorkspace
        kicker={_('account_backend.opening.title')}
        title={`${_('account_backend.opening.batch')} ${String(options.batch.accountingDate)}`}
        subtitle={`${_('account_backend.opening.source')}: ${String(options.batch.sourceChecksum)}`}
        status={stateBadge(_, options.batch.state)}
        imageFallback={icon('notebook-tabs')}
        summary={[
          { id: 'lines', label: _('account_backend.opening.lines'), value: options.lines.length },
          { id: 'debit', label: _('account_backend.field.debit'), value: String(options.batch.controlDebit) },
          {
            id: 'credit',
            label: _('account_backend.field.credit'),
            value: String(options.batch.controlCredit),
          },
        ]}
        body={stack(
          [
            <Section
              title={_('account_backend.opening.control')}
              description={_('account_backend.opening.controlHint')}
              actions={
                options.entryHref ? (
                  <LinkButton label={_('account_backend.opening.openEntry')} href={options.entryHref} />
                ) : undefined
              }
              body={
                <Surface
                  padding="compact"
                  body={dataTable(_, {
                    rows: options.lines,
                    id: (row) => String(row.id),
                    columns: [
                      { key: 'sequence', label: '#', cell: (row) => String(row.sequence), align: 'end' },
                      {
                        key: 'account',
                        label: _('account_backend.field.accountId'),
                        priority: 'primary',
                        cell: (row) => code(String(row.accountId)),
                      },
                      {
                        key: 'partner',
                        label: _('account_backend.field.partnerId'),
                        cell: (row) => String(row.partnerId ?? '—'),
                      },
                      {
                        key: 'label',
                        label: _('account_backend.field.name'),
                        cell: (row) => String(row.description ?? ''),
                      },
                      {
                        key: 'debit',
                        label: _('account_backend.field.debit'),
                        cell: (row) => formatMoney(_, row.debit, options.currency),
                        align: 'end',
                        kind: 'currency',
                      },
                      {
                        key: 'credit',
                        label: _('account_backend.field.credit'),
                        cell: (row) => formatMoney(_, row.credit, options.currency),
                        align: 'end',
                        kind: 'currency',
                      },
                    ],
                  })}
                />
              }
            />,
            options.batch.state === 'validated' ? (
              <Section
                title={_('account_backend.opening.post')}
                description={_('account_backend.opening.postHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        id="opening-post-form"
                        scope="opening-post"
                        action={options.action}
                        submit={_('account_backend.opening.post')}
                        submitVariant="primary"
                        hidden={{ action: 'post' }}
                        fields={[]}
                      />
                    }
                  />
                }
              />
            ) : null,
          ],
          'loose',
        )}
      />
    }
  />
)
