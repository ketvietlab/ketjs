import type { Translator } from 'ketjs'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  formatMoney,
  formCluster as FormCluster,
  framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const moveDetailScreen = (
  _: Translator,
  move: Row,
  lines: Row[],
  frame: Frame,
  accountOptions: Array<{ value: string; label: string }>,
  action: string,
  collaboration: JSXChild,
): TemplateResult => {
  const draft = move.state === 'draft'
  const residual = lines.reduce((total, line) => total + Number(line.amountResidual ?? 0), 0)
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
            label: _('account_backend.field.accountId'),
            cell: (line) => code(String(line.accountId)),
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

  return framed(
    _,
    String(move.name),
    frame,
    <RecordWorkspace
      kicker={_('account_backend.move.kicker')}
      title={String(move.name)}
      subtitle={String(move.ref ?? move.partnerId ?? '')}
      imageFallback={icon('banknote')}
      badges={[
        badge(
          labelOf(_, 'moveState', move.state),
          move.state === 'posted' ? 'positive' : 'neutral',
          String(move.state),
        ),
        badge(
          labelOf(_, 'paymentState', move.paymentState),
          move.paymentState === 'paid' ? 'positive' : 'warning',
        ),
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
          actionForms.length ? (
            <FormCluster forms={actionForms} label={_('account_backend.move.actions')} />
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
                        { name: 'debit', label: _('account_backend.field.debit'), type: 'decimal', value: 0 },
                        {
                          name: 'credit',
                          label: _('account_backend.field.credit'),
                          type: 'decimal',
                          value: 0,
                        },
                      ]}
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
    />,
  )
}
