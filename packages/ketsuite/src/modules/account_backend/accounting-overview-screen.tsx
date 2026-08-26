/**
 * The accounting overview.
 *
 * What replaced the card grid that used to be here: that screen counted the
 * lists it linked to, which is navigation the sidebar already provides, and told
 * nobody whether the month had gone well. This one answers that from the ledger
 * — the same posted moves the trial balance reports, so a figure here and a
 * report one click away agree or one of them is wrong.
 *
 * Every number arrives computed. The screen decides arrangement and wording and
 * nothing else, which is why the comparison logic is `changeOf` in the kit
 * rather than arithmetic scattered through the markup: whether a change is good
 * news depends on the metric, and total liabilities falling is the case that
 * catches a dashboard out.
 */

import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  BarChart,
  CardGrid,
  columns,
  changeOf,
  Chart,
  dataTable,
  DatePicker,
  Delta,
  emptyState,
  formatMoney,
  Framed,
  icon,
  Metric,
  RecordWorkspace,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../ui/index.ts'
import type { ChartBar, ChartKey, DatePickerField, Frame, Tab } from '../../ui/index.ts'
import { PERIOD_PRESETS } from './overview.ts'

type Row = Record<string, unknown>

/** A chart the route already resolved, with the legend that survives without it. */
export type OverviewChart = { plot: JSXChild | null; keys: readonly ChartKey[] }

export type AccountingOverviewOptions = {
  frame: Frame
  /** The date filter posts back to the screen's own path. */
  action: string
  /** Which named window is showing: a preset, a four-digit year, or `custom`. */
  preset: string
  /** The years the ledger covers, newest first. */
  years: readonly number[]
  /** Where a named window lives. The name travels, not the dates it resolves to. */
  presetHref: (name: string) => string
  /**
   * What the filter has to carry across a submit.
   *
   * A GET form replaces the whole query string with its own fields, so anything
   * in `action` after the `?` is discarded by the browser — the chosen language
   * included. It travels as a hidden input or it does not travel.
   */
  hidden?: Readonly<Record<string, string>>
  fields: readonly [DatePickerField, DatePickerField]
  /** `account.performance` over the window, and over the window before it. */
  current: Row
  previous: Row
  /** `account.position` as at the end of the window, and as at the day before it opened. */
  position: Row
  opening: Row
  openItems: Row
  cashFlow: Row
  revenue: OverviewChart
  mix: OverviewChart
  currency: unknown
  standard: string
  /** The ledger behind an account's total. A number nobody can open is one to trust blindly. */
  ledgerHref: (accountId: string) => string
  partnerHref: (partnerId: string) => string
}

const n = (value: unknown): number => Number(value ?? 0)

/**
 * A percentage, or a word saying there is none.
 *
 * `changeOf` returns a null ratio when the previous period was zero, and there
 * is no honest percentage to print for that — a first month of trading did not
 * grow by 0%, it has nothing to have grown from.
 */
const percent = (_: Translator, ratio: number | null): string =>
  ratio === null
    ? _('account_backend.overview.noComparison')
    : `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)}% ${_('account_backend.overview.versusPrevious')}`

const trend = (_: Translator, current: unknown, previous: unknown, better: 'higher' | 'lower'): JSXChild => {
  const change = changeOf(n(current), n(previous), better)
  return <Delta label={percent(_, change.ratio)} direction={change.direction} sentiment={change.sentiment} />
}

const ratioText = (_: Translator, value: unknown): string =>
  value === null || value === undefined
    ? _('account_backend.overview.noComparison')
    : `${(n(value) * 100).toFixed(1)}%`

/**
 * The named windows, as a row of links.
 *
 * Links rather than a form: each is an address, so it is bookmarkable, opens in
 * a new tab, and works with nothing running in the browser — the same rule the
 * rest of this screen keeps by holding its whole state in the URL.
 */
const presets = (_: Translator, o: AccountingOverviewOptions): Tab[] =>
  PERIOD_PRESETS.map((name) => ({
    id: name,
    label: _(`account_backend.overview.preset.${name}`),
    href: o.presetHref(name),
    active: o.preset === name,
  }))

/** A year, or the typed range that narrowing one produces. Nothing else takes dates. */
const refinable = (preset: string): boolean => /^\d{4}$/.test(preset) || preset === 'custom'

const years = (_: Translator, o: AccountingOverviewOptions): Tab[] =>
  o.years.map((year) => ({
    id: String(year),
    label: String(year),
    href: o.presetHref(String(year)),
    active: o.preset === String(year),
  }))

const kpis = (_: Translator, o: AccountingOverviewOptions): TemplateResult => {
  const cards: Array<{
    id: string
    label: string
    value: unknown
    was: unknown
    better: 'higher' | 'lower'
  }> = [
    {
      id: 'revenue',
      label: _('account_backend.overview.revenue'),
      value: o.current.revenue,
      was: o.previous.revenue,
      better: 'higher',
    },
    {
      id: 'profit',
      label: _('account_backend.overview.profit'),
      value: o.current.profit,
      was: o.previous.profit,
      better: 'higher',
    },
    {
      id: 'cash',
      label: _('account_backend.overview.cash'),
      value: o.position.cash,
      was: o.opening.cash,
      better: 'higher',
    },
    {
      id: 'assets',
      label: _('account_backend.overview.assets'),
      value: o.position.assets,
      was: o.opening.assets,
      better: 'higher',
    },
    {
      // Liabilities are the card that makes the direction/sentiment split earn
      // its keep: this one falling is the good news, and an arrow coloured by
      // direction alone painted it the same red as revenue falling.
      id: 'liabilities',
      label: _('account_backend.overview.liabilities'),
      value: o.position.liabilities,
      was: o.opening.liabilities,
      better: 'lower',
    },
  ]
  return (
    <CardGrid
      items={cards}
      id={(card) => card.id}
      card={(card) => (
        <Metric
          label={card.label}
          value={formatMoney(_, card.value, o.currency)}
          trend={trend(_, card.value, card.was, card.better)}
          tone="money"
        />
      )}
    />
  )
}

const expenses = (_: Translator, o: AccountingOverviewOptions): TemplateResult => {
  const rows = (o.current.expenseByAccount as Row[] | undefined) ?? []
  const bars: ChartBar[] = rows.map((row) => ({
    id: String(row.accountId),
    label: `${row.code} · ${row.name}`,
    value: n(row.amount),
    href: o.ledgerHref(String(row.accountId)),
  }))
  return (
    <BarChart
      bars={bars}
      value={(bar) => formatMoney(_, bar.value, o.currency)}
      empty={_('account_backend.overview.noExpense')}
    />
  )
}

/** One side of the open items: what is owed, and who owes most of it. */
const owed = (
  _: Translator,
  side: Row,
  currency: unknown,
  empty: string,
  href: (id: string) => string,
): TemplateResult => {
  const partners = (side.partners as Row[] | undefined) ?? []
  if (!partners.length) return emptyState(empty, '', { icon: icon('receipt') })
  return dataTable(_, {
    rows: partners,
    id: (row: Row) => String(row.partnerId),
    // The statement behind a balance, per partner: the same rule the trial
    // balance follows, that a total nobody can open is a number to trust blindly.
    rowHref: (row: Row) => href(String(row.partnerId)),
    columns: [
      {
        key: 'name',
        label: _('account_backend.overview.partner'),
        priority: 'primary',
        cell: (row: Row) => String(row.name),
      },
      {
        key: 'total',
        label: _('account_backend.overview.outstanding'),
        align: 'end',
        kind: 'currency',
        cell: (row: Row) => formatMoney(_, row.total, currency),
      },
      {
        key: 'overdue',
        label: _('account_backend.overview.overdue'),
        align: 'end',
        kind: 'currency',
        cell: (row: Row) => formatMoney(_, row.overdue, currency),
      },
    ],
  })
}

export const accountingOverviewScreen = (
  _: Translator,
  options: AccountingOverviewOptions,
): TemplateResult => {
  const money = (value: unknown) => formatMoney(_, value, options.currency)
  const cashRows = [
    { id: 'sales', label: _('account_backend.overview.cashSales'), amount: options.cashFlow.sales },
    {
      id: 'purchases',
      label: _('account_backend.overview.cashPurchases'),
      amount: options.cashFlow.purchases,
    },
    {
      id: 'operating',
      label: _('account_backend.overview.cashOperating'),
      amount: options.cashFlow.operating,
    },
    { id: 'other', label: _('account_backend.overview.cashOther'), amount: options.cashFlow.other },
    { id: 'net', label: _('account_backend.overview.cashNet'), amount: options.cashFlow.net },
  ]

  /** Total, not yet due, overdue — the three numbers an aging is, said once. */
  const aging = (side: Row): string =>
    `${_('account_backend.overview.outstanding')}: ${money(side.total)} · ${_(
      'account_backend.overview.notYetDue',
    )}: ${money(side.current)} · ${_('account_backend.overview.overdue')}: ${money(side.overdue)}`

  const receivable = options.openItems.receivable as Row
  const payable = options.openItems.payable as Row

  return (
    <Framed
      translator={_}
      title={_('account_backend.overview.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.dashboard.kicker')}
          title={_('account_backend.overview.title')}
          subtitle={`${_('account_backend.overview.subtitle')} · ${options.standard}`}
          imageFallback={icon('banknote')}
          body={stack(
            [
              <Section
                title={_('account_backend.overview.period')}
                description={_('account_backend.overview.periodHint')}
                body={
                  <Surface
                    padding="compact"
                    body={stack([
                      <Tabs label={_('account_backend.overview.period')} items={presets(_, options)} wrap />,
                      // A year is offered even when the ledger covers only one:
                      // "2026" is the whole year, which is a different question
                      // from "this month" and the only way to ask it in one click.
                      <Tabs label={_('account_backend.overview.byYear')} items={years(_, options)} wrap />,
                      // The date fields belong to a year and appear with one.
                      //
                      // A relative window is already exact — "the last 30 days"
                      // has nothing left to narrow, and a pair of dates sitting
                      // under it invited the reader to edit numbers that the
                      // next click would overwrite. A year is the coarse frame
                      // that does have something inside it worth narrowing, and
                      // a typed range is what narrowing it produces, so the
                      // fields stay while that range is what is showing.
                      ...(refinable(options.preset)
                        ? [
                            <DatePicker
                              action={options.action}
                              hidden={options.hidden}
                              label={_('account_backend.overview.custom')}
                              fields={options.fields}
                              submit={_('account_backend.action.calculate')}
                            />,
                          ]
                        : []),
                    ])}
                  />
                }
              />,
              <Section
                title={_('account_backend.overview.headline')}
                description={_('account_backend.overview.headlineHint')}
                body={kpis(_, options)}
              />,
              <Section
                title={_('account_backend.overview.revenueTrend')}
                description={_('account_backend.overview.revenueTrendHint')}
                body={
                  <Surface
                    body={
                      <Chart
                        plot={options.revenue.plot}
                        keys={options.revenue.keys}
                        kind="line"
                        empty={_('account_backend.overview.noRevenue')}
                      />
                    }
                  />
                }
              />,
              // Where the money came from and where it went, side by side:
              // the two are read against each other, and stacked they were a
              // scroll apart.
              columns([
                <Section
                  title={_('account_backend.overview.mix')}
                  description={`${_('account_backend.overview.revenue')}: ${money(options.current.revenue)}`}
                  body={
                    <Surface
                      body={
                        <Chart
                          plot={options.mix.plot}
                          keys={options.mix.keys}
                          kind="doughnut"
                          empty={_('account_backend.overview.noRevenue')}
                        />
                      }
                    />
                  }
                />,
                <Section
                  title={_('account_backend.overview.expenses')}
                  description={`${_('account_backend.overview.totalExpense')}: ${money(
                    options.current.expense,
                  )} · ${_('account_backend.overview.grossMargin')}: ${ratioText(
                    _,
                    options.current.grossMargin,
                  )} (${_('account_backend.overview.previous')}: ${ratioText(_, options.previous.grossMargin)})`}
                  body={<Surface body={expenses(_, options)} />}
                />,
              ]),
              <Section
                title={_('account_backend.overview.receivable')}
                description={aging(receivable)}
                body={
                  <Surface
                    padding="none"
                    body={owed(
                      _,
                      receivable,
                      options.currency,
                      _('account_backend.overview.noReceivable'),
                      options.partnerHref,
                    )}
                  />
                }
              />,
              <Section
                title={_('account_backend.overview.payable')}
                description={aging(payable)}
                body={
                  <Surface
                    padding="none"
                    body={owed(
                      _,
                      payable,
                      options.currency,
                      _('account_backend.overview.noPayable'),
                      options.partnerHref,
                    )}
                  />
                }
              />,
              <Section
                title={_('account_backend.overview.cashFlow')}
                description={_('account_backend.overview.cashFlowHint')}
                body={
                  <Surface
                    padding="none"
                    body={dataTable(_, {
                      rows: cashRows,
                      id: (row) => row.id,
                      columns: [
                        {
                          key: 'label',
                          label: _('account_backend.overview.movement'),
                          priority: 'primary',
                          cell: (row) => row.label,
                        },
                        {
                          key: 'amount',
                          label: _('account_backend.field.balance'),
                          align: 'end',
                          kind: 'currency',
                          cell: (row) => money(row.amount),
                        },
                      ],
                    })}
                  />
                }
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
