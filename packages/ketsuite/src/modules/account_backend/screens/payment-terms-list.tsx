import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'

export type PaymentTermRow = Record<string, unknown>

export type PaymentTermSummary = {
  total: number
  configured: number
  lines: number
}

export type PaymentTermsListScreenOptions = {
  frame: Frame
  rows: PaymentTermRow[]
  createHref: string
  lineCreateHref?: string
  rowHref: (row: PaymentTermRow) => string
  lineHref: (line: PaymentTermRow) => string
  delayLabel: (line: PaymentTermRow) => string
  valueLabel: (line: PaymentTermRow) => string
  summary: PaymentTermSummary
  table?: Partial<DataTable<PaymentTermRow>>
}

const linesOf = (row: PaymentTermRow): PaymentTermRow[] =>
  Array.isArray(row.lines) ? (row.lines as PaymentTermRow[]) : []

export const paymentTermsListScreen = (
  _: Translator,
  options: PaymentTermsListScreenOptions,
): TemplateResult => {
  const milestones = options.rows
    .flatMap((row) =>
      linesOf(row).map((line): PaymentTermRow & { term: PaymentTermRow } => ({ ...line, term: row })),
    )
    .sort(
      (a, b) =>
        String(a.term.name).localeCompare(String(b.term.name)) ||
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
    )
  const status = [
    `${_('account_backend.term.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.term.summary.configured')}: ${String(options.summary.configured)}`,
    `${_('account_backend.term.summary.lines')}: ${String(options.summary.lines)}`,
  ].join(' · ')
  const terms =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: [
          {
            key: 'name',
            label: _('account_backend.field.name'),
            priority: 'primary',
            width: 'wide',
            cell: (row) => String(row.name),
          },
          {
            key: 'lines',
            label: _('account_backend.terms.lines'),
            kind: 'number',
            align: 'end',
            cell: (row) => String(linesOf(row).length),
          },
          {
            key: 'note',
            label: _('account_backend.field.note'),
            cell: (row) => String(row.note ?? '—'),
          },
          {
            key: 'active',
            label: _('account_backend.field.active'),
            kind: 'status',
            cell: (row) =>
              badge(
                row.active ? _('account_backend.active') : _('account_backend.archived'),
                row.active ? 'positive' : 'neutral',
                row.active ? 'active' : 'archived',
              ),
          },
        ],
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.term.empty'), _('account_backend.term.emptyHint'), {
          icon: icon('credit-card'),
        })}
      />
    )
  const milestoneTable = milestones.length ? (
    dataTable(_, {
      rows: milestones,
      id: (line) => String(line.id),
      rowHref: options.lineHref,
      columns: [
        {
          key: 'term',
          label: _('account_backend.field.paymentTermId'),
          priority: 'primary',
          width: 'wide',
          cell: (line) => String((line.term as PaymentTermRow).name),
        },
        {
          key: 'value',
          label: _('account_backend.field.termValue'),
          cell: (line) =>
            `${String(line.valueAmount)}${line.value === 'percent' ? '%' : ''} · ${options.valueLabel(line)}`,
        },
        {
          key: 'delay',
          label: _('account_backend.field.delayType'),
          cell: (line) => options.delayLabel(line),
        },
        {
          key: 'days',
          label: _('account_backend.field.nbDays'),
          cell: (line) => String(line.nbDays ?? 0),
          align: 'end',
          kind: 'number',
        },
        {
          key: 'dayOfMonth',
          label: _('account_backend.field.daysNextMonth'),
          cell: (line) => String(line.daysNextMonth ?? '—'),
          align: 'end',
          kind: 'number',
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        _('account_backend.term.milestones.empty'),
        _('account_backend.term.milestones.emptyHint'),
        { icon: icon('credit-card') },
      )}
    />
  )

  return shell(
    _,
    _('account_backend.terms.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('account_backend.terms.title')}
      description={_('account_backend.term.subtitle')}
      actions={inline([
        <LinkButton
          label={_('account_backend.action.createTerm')}
          href={options.createHref}
          variant="primary"
        />,
        options.lineCreateHref ? (
          <LinkButton
            label={_('account_backend.action.addTermLine')}
            href={options.lineCreateHref}
            variant="secondary"
          />
        ) : undefined,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.terms.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={status}
      body={stack(
        [
          <Section
            title={_('account_backend.term.list.title')}
            description={_('account_backend.term.list.hint')}
            body={terms}
          />,
          <Section
            title={_('account_backend.term.milestones.title')}
            description={_('account_backend.term.milestones.hint')}
            body={milestoneTable}
          />,
        ],
        'loose',
      )}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
