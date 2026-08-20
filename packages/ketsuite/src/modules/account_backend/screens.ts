import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  code,
  contentCard,
  dataTable,
  emptyState,
  framed,
  linkButton,
  metric,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>

const movePath = (move: AnyRow): string =>
  move.moveType === 'entry'
    ? `/admin/journal-entries/${String(move.id)}`
    : String(move.moveType).startsWith('out_')
      ? `/admin/customer-invoices/${String(move.id)}`
      : `/admin/vendor-bills/${String(move.id)}`

export const labelOf = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value ?? '')
  const key = `account_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

export const optionsOf = (_: Translator, group: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: labelOf(_, group, value) }))

const empty = (_: Translator) => emptyState(_('account_backend.empty'), _('account_backend.emptyHint'))

export const accountingDashboard = (
  _: Translator,
  counts: { accounts: number; journals: number; draft: number; posted: number; unpaid: number },
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('account_backend.dashboard.title'),
    frame,
    stack([
      cardGrid({
        items: [
          {
            id: 'accounts',
            title: _('account_backend.menu.accounts'),
            value: counts.accounts,
            href: '/admin/accounts',
          },
          {
            id: 'journals',
            title: _('account_backend.menu.journals'),
            value: counts.journals,
            href: '/admin/journals',
          },
          {
            id: 'draft',
            title: _('account_backend.dashboard.draft'),
            value: counts.draft,
            href: '/admin/journal-entries?state=draft',
          },
          {
            id: 'posted',
            title: _('account_backend.dashboard.posted'),
            value: counts.posted,
            href: '/admin/journal-entries?state=posted',
          },
          {
            id: 'unpaid',
            title: _('account_backend.dashboard.unpaid'),
            value: counts.unpaid,
            href: '/admin/customer-invoices',
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({
            title: item.title,
            href: item.href,
            body: metric({ label: _('account_backend.dashboard.records'), value: String(item.value) }),
          }),
      }),
      section({
        title: _('account_backend.dashboard.reports'),
        body: cardGrid({
          items: [
            { id: 'trial', title: _('account_backend.menu.trialBalance'), href: '/admin/trial-balance' },
            { id: 'ledger', title: _('account_backend.menu.generalLedger'), href: '/admin/general-ledger' },
            {
              id: 'partner',
              title: _('account_backend.menu.partnerStatement'),
              href: '/admin/partner-statement',
            },
          ],
          id: (item) => item.id,
          card: (item) => contentCard({ title: item.title, href: item.href }),
        }),
      }),
    ]),
  )

export const entityScreen = (
  _: Translator,
  o: {
    title: string
    frame: Frame
    action: string
    submit: string
    fields: readonly FormField[]
    extraForms?: Array<{
      action: string
      submit: string
      hidden?: Record<string, string>
      fields: readonly FormField[]
    }>
    rows: AnyRow[]
    columns: Array<Column<AnyRow>>
  },
): TemplateResult =>
  framed(
    _,
    o.title,
    o.frame,
    stack([
      surface({
        body: recordForm({
          action: o.action,
          submit: o.submit,
          submitVariant: 'primary',
          fields: o.fields,
        }),
      }),
      ...(o.extraForms ?? []).map((form) =>
        surface({
          body: recordForm({
            action: form.action,
            submit: form.submit,
            submitVariant: 'secondary',
            hidden: form.hidden,
            fields: form.fields,
          }),
        }),
      ),
      o.rows.length
        ? dataTable(_, { rows: o.rows, columns: o.columns, id: (row) => String(row.id) })
        : empty(_),
    ]),
  )

export const movesScreen = (
  _: Translator,
  o: {
    title: string
    frame: Frame
    action: string
    fields: readonly FormField[]
    rows: AnyRow[]
  },
): TemplateResult =>
  framed(
    _,
    o.title,
    o.frame,
    stack([
      surface({
        body: recordForm({
          action: o.action,
          submit: _('account_backend.action.create'),
          submitVariant: 'primary',
          fields: o.fields,
        }),
      }),
      o.rows.length
        ? dataTable(_, {
            rows: o.rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('account_backend.field.name'),
                cell: (row) =>
                  linkButton({
                    label: String(row.name),
                    href: movePath(row),
                    variant: 'tertiary',
                  }),
                priority: 'primary',
              },
              {
                key: 'date',
                label: _('account_backend.field.date'),
                cell: (row) => String(row.date).slice(0, 10),
              },
              {
                key: 'type',
                label: _('account_backend.field.moveType'),
                cell: (row) => labelOf(_, 'moveType', row.moveType),
              },
              {
                key: 'state',
                label: _('account_backend.field.state'),
                cell: (row) => badge(labelOf(_, 'moveState', row.state), 'neutral', String(row.state)),
              },
              {
                key: 'payment',
                label: _('account_backend.field.paymentState'),
                cell: (row) => labelOf(_, 'paymentState', row.paymentState),
              },
              {
                key: 'total',
                label: _('account_backend.field.amountTotal'),
                cell: (row) => `${String(row.amountTotal)} ${String(row.currency)}`,
              },
            ],
          })
        : empty(_),
    ]),
  )

export const moveDetailScreen = (
  _: Translator,
  move: AnyRow,
  lines: AnyRow[],
  frame: Frame,
  accountOptions: Array<{ value: string; label: string }>,
): TemplateResult =>
  framed(
    _,
    String(move.name),
    frame,
    stack([
      cardGrid({
        items: [
          {
            id: 'state',
            label: _('account_backend.field.state'),
            value: labelOf(_, 'moveState', move.state),
          },
          {
            id: 'type',
            label: _('account_backend.field.moveType'),
            value: labelOf(_, 'moveType', move.moveType),
          },
          {
            id: 'total',
            label: _('account_backend.field.amountTotal'),
            value: `${String(move.amountTotal)} ${String(move.currency)}`,
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({ title: item.label, body: metric({ label: item.label, value: item.value }) }),
      }),
      section({
        title: _('account_backend.lines.title'),
        body: lines.length
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
                { key: 'debit', label: _('account_backend.field.debit'), cell: (line) => String(line.debit) },
                {
                  key: 'credit',
                  label: _('account_backend.field.credit'),
                  cell: (line) => String(line.credit),
                },
                {
                  key: 'residual',
                  label: _('account_backend.field.residual'),
                  cell: (line) => String(line.amountResidual),
                },
              ],
            })
          : empty(_),
      }),
      ...(move.state === 'draft'
        ? [
            section({
              title: _('account_backend.lines.add'),
              body: surface({
                body: recordForm({
                  action: movePath(move),
                  submit: _('account_backend.action.addLine'),
                  submitVariant: 'secondary',
                  hidden: { action: 'add-line' },
                  fields: [
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
                    { name: 'credit', label: _('account_backend.field.credit'), type: 'decimal', value: 0 },
                  ],
                }),
              }),
            }),
            surface({
              body: recordActions({
                action: movePath(move),
                actions: [
                  {
                    value: 'post',
                    label: _('account_backend.action.post'),
                    variant: 'primary',
                  },
                  {
                    value: 'cancel',
                    label: _('account_backend.action.cancel'),
                    variant: 'destructive',
                  },
                ],
              }),
            }),
          ]
        : []),
    ]),
  )

export const reportScreen = (
  _: Translator,
  o: {
    title: string
    frame: Frame
    action: string
    fields: readonly FormField[]
    rows: AnyRow[]
    columns: Array<Column<AnyRow>>
  },
): TemplateResult =>
  framed(
    _,
    o.title,
    o.frame,
    stack([
      surface({
        body: recordForm({
          action: o.action,
          method: 'get',
          submit: _('account_backend.action.calculate'),
          submitVariant: 'secondary',
          fields: o.fields,
        }),
      }),
      o.rows.length
        ? dataTable(_, { rows: o.rows, columns: o.columns, id: (row) => String(row.id ?? row.accountId) })
        : empty(_),
    ]),
  )
