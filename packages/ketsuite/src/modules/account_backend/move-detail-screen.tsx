import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  formatMoney,
  FormCluster,
  Framed,
  icon,
  Notice,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { labelOf, moveTitle } from './screens/shared.tsx'

type Row = Record<string, unknown>

export const moveDetailScreen = (
  _: Translator,
  move: Row,
  lines: Row[],
  frame: Frame,
  accountOptions: Array<{ value: string; label: string }>,
  action: string,
  collaboration: JSXChild,
  printActions?: JSXChild,
  errors?: string[],
): TemplateResult => {
  const draft = move.state === 'draft'
  const accountLabels = new Map(accountOptions.map((option) => [option.value, option.label]))
  const residual = lines.reduce((total, line) => total + Number(line.amountResidual ?? 0), 0)
  const title = moveTitle(_, move)
  // Payment state is a property of a document that someone owes money on. A manual
  // journal entry has none, and labelling every draft entry "paid" said nothing.
  const showsPaymentState = move.moveType !== 'entry'
  const actionForms = draft
    ? [
        <RecordForm
          scope="account-move"
          action={action}
          submit={_('account_backend.action.post')}
          submitVariant="primary"
          layout="inline"
          hidden={{ action: 'post' }}
          fields={[]}
        />,
        <RecordForm
          scope="account-move"
          action={action}
          submit={_('account_backend.action.cancel')}
          submitVariant="destructive"
          layout="inline"
          hidden={{ action: 'cancel' }}
          fields={[]}
        />,
      ]
    : // A posted entry is never edited or deleted. The correction is its mirror
      // image, posted as a second entry.
      move.state === 'posted'
      ? [
          <RecordForm
            scope="account-move"
            action={action}
            submit={_('account_backend.action.reverse')}
            submitVariant="destructive"
            layout="inline"
            hidden={{ action: 'reverse' }}
            fields={[]}
          />,
        ]
      : []
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
            // The account a line posts to, by the label the pickers use. A raw id
            // is not something a reader can check a journal entry against.
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

  return (
    <Framed
      translator={_}
      title={title}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.move.kicker')}
          title={title}
          subtitle={String(move.ref ?? move.partnerId ?? '')}
          imageFallback={icon('banknote')}
          badges={[
            badge(
              labelOf(_, 'moveState', move.state),
              move.state === 'posted' ? 'positive' : 'neutral',
              String(move.state),
            ),
            ...(showsPaymentState
              ? [
                  badge(
                    labelOf(_, 'paymentState', move.paymentState),
                    move.paymentState === 'paid' ? 'positive' : 'warning',
                  ),
                ]
              : []),
          ]}
          summary={[
            {
              id: 'total',
              label: _('account_backend.field.amountTotal'),
              value: formatMoney(_, move.amountTotal, move.currency),
            },
            {
              id: 'residual',
              label: _('account_backend.field.residual'),
              value: formatMoney(_, residual, move.currency),
            },
            {
              id: 'type',
              label: _('account_backend.field.moveType'),
              value: labelOf(_, 'moveType', move.moveType),
            },
          ]}
          body={stack(
            [
              // Posting and reversing both refuse for concrete reasons — an
              // unbalanced entry, a document already in the books. The reader has to
              // be told which, whether or not this document still shows a line form.
              errors?.length ? (
                <Notice tone="danger" title={_('account_backend.move.refused')} message={errors.join(' ')} />
              ) : null,
              actionForms.length ? (
                <FormCluster forms={actionForms} label={_('account_backend.move.actions')} />
              ) : null,
              printActions === undefined ? null : <Surface body={printActions} />,
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
                          action={action}
                          submit={_('account_backend.action.addLine')}
                          submitVariant="secondary"
                          hidden={{ action: 'add-line' }}
                          fields={[
                            { name: 'name', label: _('account_backend.field.name'), required: true },
                            {
                              name: 'accountId',
                              label: _('account_backend.field.accountId'),
                              type: 'select',
                              options: accountOptions,
                              required: true,
                            },
                            { name: 'partnerId', label: _('account_backend.field.partnerId') },
                            {
                              name: 'debit',
                              label: _('account_backend.field.debit'),
                              type: 'decimal',
                              value: 0,
                            },
                            {
                              name: 'credit',
                              label: _('account_backend.field.credit'),
                              type: 'decimal',
                              value: 0,
                            },
                          ]}
                          errors={errors}
                        />
                      }
                    />
                  }
                />
              ) : null,
            ],
            'loose',
          )}
          aside={collaboration}
          asideLabel={_('account_backend.move.collaboration')}
          slots={{ header: 'account.move-header', body: 'account.move-body' }}
        />
      }
    />
  )
}
