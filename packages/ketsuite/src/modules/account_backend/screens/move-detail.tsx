import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  formatMoney,
  FormCluster,
  FormPage,
  icon,
  inline,
  Notice,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { addDecimals } from '../../account/money.ts'
import { labelOf, moveTitle } from './shared.tsx'

export type MoveDetailRow = Record<string, unknown>

export type MoveDetailRejection = {
  messages: string[]
  fields: Record<string, string>
  values: Record<string, string>
}

export type MoveDetailScreenOptions = {
  move: MoveDetailRow
  lines: MoveDetailRow[]
  frame: Frame
  accountOptions: Array<{ value: string; label: string }>
  action: string
  collaboration: JSXChild
  printActions?: JSXChild
  rejected?: MoveDetailRejection
  lineId: string
  reversalId: string
}

const stateTone = (state: unknown) => (state === 'posted' ? ('positive' as const) : ('neutral' as const))

export const moveDetailScreen = (_: Translator, options: MoveDetailScreenOptions): TemplateResult => {
  const { move, lines } = options
  const draft = move.state === 'draft'
  const rejectedAccountId = options.rejected?.values.accountId
  const accountOptions =
    rejectedAccountId && !options.accountOptions.some((option) => option.value === rejectedAccountId)
      ? [{ value: rejectedAccountId, label: rejectedAccountId }, ...options.accountOptions]
      : options.accountOptions
  const accountLabels = new Map(accountOptions.map((option) => [option.value, option.label]))
  const residual = lines.reduce((total, line) => addDecimals(total, line.amountResidual ?? '0'), '0')
  const title = moveTitle(_, move)
  const showsPaymentState = move.moveType !== 'entry'
  const expectedRevision = String(move.revision ?? 0)
  const actionForms: JSXChild[] = draft
    ? [
        <RecordForm
          scope="account-move"
          action={options.action}
          submit={_('account_backend.action.post')}
          submitVariant="primary"
          layout="inline"
          hidden={{ action: 'post', expectedRevision }}
          fields={[]}
        />,
        <RecordForm
          scope="account-move"
          action={options.action}
          submit={_('account_backend.action.cancel')}
          submitVariant="destructive"
          layout="inline"
          hidden={{ action: 'cancel', expectedRevision }}
          fields={[]}
        />,
      ]
    : move.state === 'posted'
      ? [
          <RecordForm
            scope="account-move"
            action={options.action}
            submit={_('account_backend.action.reverse')}
            submitVariant="destructive"
            layout="inline"
            hidden={{ action: 'reverse', reversalId: options.reversalId }}
            fields={[]}
          />,
        ]
      : []
  if (options.printActions !== undefined) actionForms.push(options.printActions)
  const headerActions = inline([
    actionForms.length ? <FormCluster forms={actionForms} label={_('account_backend.move.actions')} /> : null,
    options.frame.extras?.['topbar.end'] ?? '',
  ])
  const table = lines.length
    ? dataTable(_, {
        rows: lines,
        id: (line) => String(line.id),
        columns: [
          {
            key: 'name',
            label: _('account_backend.field.name'),
            cell: (line) => String(line.name),
            priority: 'primary',
          },
          {
            key: 'account',
            label: _('account_backend.field.accountId'),
            cell: (line) => code(accountLabels.get(String(line.accountId)) ?? String(line.accountId)),
          },
          {
            key: 'debit',
            label: _('account_backend.field.debit'),
            cell: (line) => formatMoney(_, line.debit, move.currency),
            align: 'end',
            kind: 'currency',
          },
          {
            key: 'credit',
            label: _('account_backend.field.credit'),
            cell: (line) => formatMoney(_, line.credit, move.currency),
            align: 'end',
            kind: 'currency',
          },
          {
            key: 'residual',
            label: _('account_backend.field.residual'),
            cell: (line) => formatMoney(_, line.amountResidual, move.currency),
            align: 'end',
            kind: 'currency',
          },
        ],
      })
    : emptyState(_('account_backend.empty'), _('account_backend.emptyHint'), { icon: icon('banknote') })
  const value = (name: string, fallback: string | number = '') => options.rejected?.values[name] ?? fallback
  const lineFields: FormField[] = [
    {
      name: 'name',
      label: _('account_backend.field.name'),
      required: true,
      value: value('name'),
      error: options.rejected?.fields.name,
    },
    {
      name: 'accountId',
      label: _('account_backend.field.accountId'),
      type: 'select',
      options: accountOptions,
      required: true,
      value: value('accountId'),
      error: options.rejected?.fields.accountId,
    },
    {
      name: 'partnerId',
      label: _('account_backend.field.partnerId'),
      value: value('partnerId'),
      error: options.rejected?.fields.partnerId,
    },
    {
      name: 'debit',
      label: _('account_backend.field.debit'),
      type: 'decimal',
      value: value('debit', 0),
      error: options.rejected?.fields.debit,
    },
    {
      name: 'credit',
      label: _('account_backend.field.credit'),
      type: 'decimal',
      value: value('credit', 0),
      error: options.rejected?.fields.credit,
    },
  ]

  return shell(
    _,
    title,
    <FormPage
      scope="account-move-detail-form-page"
      title={title}
      description={String(move.ref ?? move.partnerId ?? '') || undefined}
      status={inline([
        badge(labelOf(_, 'moveState', move.state), stateTone(move.state), String(move.state)),
        ...(showsPaymentState
          ? [
              badge(
                labelOf(_, 'paymentState', move.paymentState),
                move.paymentState === 'paid' ? 'positive' : 'warning',
                String(move.paymentState),
              ),
            ]
          : []),
      ])}
      actions={headerActions}
      meta={inline([
        badge(
          `${_('account_backend.field.amountTotal')}: ${formatMoney(_, move.amountTotal, move.currency)}`,
          'info',
        ),
        badge(
          `${_('account_backend.field.residual')}: ${formatMoney(_, residual, move.currency)}`,
          residual ? 'warning' : 'neutral',
        ),
        badge(`${_('account_backend.field.moveType')}: ${labelOf(_, 'moveType', move.moveType)}`, 'neutral'),
      ])}
      body={stack(
        [
          options.rejected?.messages.length ? (
            <Notice
              tone="danger"
              title={_('account_backend.move.refused')}
              message={options.rejected.messages.join(' ')}
            />
          ) : null,
          <Section title={_('account_backend.lines.title')} body={table} />,
          draft ? (
            <Section
              title={_('account_backend.lines.add')}
              body={
                <Surface
                  padding="compact"
                  body={
                    <RecordForm
                      id="account-move-line-form"
                      scope="account-move"
                      action={options.action}
                      submit={_('account_backend.action.addLine')}
                      submitVariant="secondary"
                      hidden={{ action: 'add-line', lineId: options.lineId }}
                      fields={lineFields}
                      errors={options.rejected?.messages}
                    />
                  }
                />
              }
            />
          ) : null,
        ],
        'loose',
      )}
      aside={options.collaboration}
      asideLabel={_('account_backend.move.collaboration')}
      slots={{ header: 'account.move-header', body: 'account.move-body' }}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
