import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  code,
  actionGroup,
  ContentCard,
  dataTable,
  DashboardPage,
  DefinitionList,
  Delta,
  emptyState,
  ListScreen,
  icon,
  linkButton,
  Metric,
  Notice,
  RecordActions,
  RecordForm,
  RecordWorkspace,
  RecordScreen,
  Section,
  shell,
  stack,
  Surface,
  Tabs,
  WorkspaceScreen,
} from '../../../ui/index.ts'
import type { FormField, Frame, Tone } from '../../../ui/index.ts'
import { selectionLabel } from '../../backend/screen.ts'
import { FormScreenFrame, ListScreenFrame } from './page-frame.tsx'

type AnyRow = Record<string, unknown>

const empty = (_: Translator) => emptyState(_('loyalty_backend.empty.title'), _('loyalty_backend.empty.hint'))

/** A stable loyalty code in the reader's language; the code itself survives as data. */
const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'loyalty_backend', group, value)

const activeBadge = (_: Translator, active: unknown) =>
  active
    ? badge(_('loyalty_backend.state.active'), 'positive', 'active')
    : badge(_('loyalty_backend.state.archived'), 'neutral', 'archived')

type Stat = { id: string; label: string; value: string; detail?: string | null; tone?: Tone }

/**
 * The row of figures a list opens with.
 *
 * They answer a question about the whole set — every wallet, the year's ledger —
 * not about the twenty rows below them, which is why they come from counts the
 * store ran rather than from the page. Above the filter, because the filter
 * changes them.
 */
const statRow = (items: Stat[]): TemplateResult => (
  <CardGrid
    items={items}
    id={(item) => item.id}
    card={(item) => (
      <Metric label={item.label} value={item.value} detail={item.detail ?? null} tone={item.tone} />
    )}
  />
)

const n = (value: unknown): number => Number(value ?? 0)

/** Grouped digits, because these are read by people counting money and points. */
const figure = (value: unknown): string => n(value).toLocaleString('vi-VN')

const percent = (part: unknown, whole: unknown): string =>
  n(whole) > 0 ? `${((n(part) / n(whole)) * 100).toFixed(1)}%` : '—'

/**
 * A movement, coloured the way a statement colours one.
 *
 * Green for points arriving and red for points leaving is the reader's
 * convention for credit and debit — it says which way the balance went, not
 * whether it going that way was a good thing.
 */
const movement = (value: unknown): TemplateResult => {
  const amount = n(value)
  return (
    <Delta
      label={`${amount > 0 ? '+' : ''}${figure(amount)}`}
      direction={amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat'}
      sentiment={amount > 0 ? 'good' : amount < 0 ? 'bad' : 'neutral'}
    />
  )
}

/**
 * What kind of entry this is, at a glance.
 *
 * Earning and redeeming are the ordinary two; an adjustment was somebody's
 * decision and a reversal undoes one, so both are worth catching the eye of an
 * accountant reading down the column.
 */
const OPERATION_TONES: Record<string, Tone> = {
  earn: 'positive',
  redeem: 'info',
  adjust: 'warning',
  expire: 'neutral',
  reverse: 'danger',
}

const operationBadge = (_: Translator, operation: unknown) =>
  badge(
    labelOf(_, 'operation', operation),
    OPERATION_TONES[String(operation)] ?? 'neutral',
    String(operation),
  )

/**
 * Where a wallet stands, which is not the same question as whether it is on.
 *
 * Locked is a decision somebody made and can unmake; expired is a date that
 * passed. Showing both as "inactive" hides which one a support agent can fix.
 */
const walletStateBadge = (_: Translator, wallet: AnyRow) => {
  if (!wallet.active) return badge(_('loyalty_backend.state.locked'), 'warning', 'locked')
  const expiresAt = wallet.expiresAt ? String(wallet.expiresAt) : null
  if (expiresAt && expiresAt <= new Date().toISOString())
    return badge(_('loyalty_backend.state.expired'), 'danger', 'expired')
  return badge(_('loyalty_backend.state.running'), 'positive', 'running')
}

/** Where a program stands in its own calendar. */
const programStateBadge = (_: Translator, program: AnyRow) => {
  //  is what this module's own archive action writes, so that is
  // what the badge says. A program the operator paused and one they retired are
  // the same row here, and inventing a second word for it would claim otherwise.
  if (!program.active) return badge(_('loyalty_backend.state.archived'), 'neutral', 'archived')
  const at = new Date().toISOString()
  if (program.dateFrom && String(program.dateFrom) > at)
    return badge(_('loyalty_backend.state.upcoming'), 'info', 'upcoming')
  if (program.dateTo && String(program.dateTo) < at)
    return badge(_('loyalty_backend.state.ended'), 'neutral', 'ended')
  return badge(_('loyalty_backend.state.running'), 'positive', 'running')
}

/** The window a program runs in, or that it never closes. */
const periodOf = (_: Translator, program: AnyRow): string => {
  const day = (value: unknown) => (value ? String(value).slice(0, 10) : null)
  const start = day(program.dateFrom)
  const end = day(program.dateTo)
  if (!start && !end) return _('loyalty_backend.period.always')
  if (start && !end) return _('loyalty_backend.period.from', { date: start })
  if (!start && end) return _('loyalty_backend.period.until', { date: end })
  return `${start} → ${end}`
}

/** The channels a program is sold through, named rather than counted. */
const channelsOf = (_: Translator, program: AnyRow): string =>
  [
    program.availableSale && _('loyalty_backend.channel.sale'),
    program.availablePos && _('loyalty_backend.channel.pos'),
    program.portalVisible && _('loyalty_backend.channel.portal'),
  ]
    .filter(Boolean)
    .join(' · ') || '—'

export const dashboardScreen = (
  _: Translator,
  frame: Frame,
  stats: { programs: number; wallets: number; members: number; ledger: number },
): TemplateResult =>
  shell(
    _,
    _('loyalty_backend.dashboard.title'),
    <DashboardPage
      variant="operational"
      frame={frame}
      title={_('loyalty_backend.dashboard.title')}
      body={stack([
        <CardGrid
          items={[
            {
              id: 'programs',
              title: _('loyalty_backend.menu.programs'),
              value: stats.programs,
              href: '/admin/loyalty/programs',
            },
            {
              id: 'wallets',
              title: _('loyalty_backend.menu.wallets'),
              value: stats.wallets,
              href: '/admin/loyalty/wallets',
            },
            {
              id: 'members',
              title: _('loyalty_backend.menu.memberships'),
              value: stats.members,
              href: '/admin/loyalty/memberships',
            },
            {
              id: 'ledger',
              title: _('loyalty_backend.menu.ledger'),
              value: stats.ledger,
              href: '/admin/loyalty/ledger',
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.title} value={String(item.value)} href={item.href} />}
        />,
        <Notice
          title={_('loyalty_backend.dashboard.ledgerTitle')}
          message={_('loyalty_backend.dashboard.ledgerHint')}
          tone="info"
        />,
      ])}
    />,
    { ...frame, topbar: false },
  )

/**
 * The programs, and where each one stands today.
 *
 * A program is not simply on or off. One that starts next month and one that
 * finished last week are both not running now and mean opposite things, so the
 * figures above count them apart and the badge in the row says which is which
 * without anyone opening it.
 */
export const programsScreen = (
  _: Translator,
  frame: Frame,
  programs: AnyRow[],
  totals: AnyRow,
  createFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('loyalty_backend.programs.title')}
    subtitle={_('loyalty_backend.programs.hint')}
    frame={frame}
    body={stack([
      statRow([
        { id: 'total', label: _('loyalty_backend.stat.programs'), value: figure(totals.total) },
        {
          id: 'running',
          label: _('loyalty_backend.stat.running'),
          value: figure(totals.running),
          tone: 'positive',
        },
        {
          id: 'upcoming',
          label: _('loyalty_backend.stat.upcoming'),
          value: figure(totals.upcoming),
          tone: 'info',
        },
        {
          id: 'archived',
          label: _('loyalty_backend.stat.archived'),
          value: figure(totals.archived),
          detail: _('loyalty_backend.stat.archivedHint'),
        },
        { id: 'ended', label: _('loyalty_backend.stat.ended'), value: figure(totals.ended) },
      ]),
      programs.length
        ? dataTable(_, {
            rows: programs,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('loyalty_backend.field.name'),
                cell: (row) =>
                  linkButton({
                    label: String(row.name),
                    href: `/admin/loyalty/programs/${String(row.id)}`,
                    variant: 'tertiary',
                  }),
                priority: 'primary',
              },
              {
                key: 'type',
                label: _('loyalty_backend.field.programType'),
                cell: (row) =>
                  badge(labelOf(_, 'programType', row.programType), 'info', String(row.programType)),
              },
              {
                key: 'period',
                label: _('loyalty_backend.field.period'),
                cell: (row) => periodOf(_, row),
                kind: 'date',
              },
              {
                key: 'trigger',
                label: _('loyalty_backend.field.trigger'),
                cell: (row) => labelOf(_, 'trigger', row.trigger),
              },
              {
                key: 'scope',
                label: _('loyalty_backend.field.availableOn'),
                cell: (row) => channelsOf(_, row),
              },
              {
                key: 'state',
                label: _('loyalty_backend.field.state'),
                cell: (row) => programStateBadge(_, row),
                kind: 'status',
              },
            ],
          })
        : empty(_),
      <Section
        title={_('loyalty_backend.action.createProgram')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/loyalty/programs"
                fields={createFields}
                errors={errors}
                submit={_('loyalty_backend.action.createProgram')}
                submitVariant="primary"
              />
            }
          />
        }
      />,
    ])}
  />
)

/**
 * One program, in the three questions it is set up by.
 *
 * What it is, how points are earned, and what they buy — three tabs rather than
 * three sections down one page, because they are edited on separate occasions
 * and each carries a form. Stacked, adding a reward meant scrolling past every
 * rule to reach the form for it.
 *
 * The settings form stays on the first tab with the identity strip above it, so
 * the state of the program is visible while it is being changed.
 */
export const programDetailScreen = (
  _: Translator,
  frame: Frame,
  program: AnyRow,
  options: {
    programFields: FormField[]
    ruleFields: FormField[]
    rewardFields: FormField[]
    tab?: string
    errors?: string[]
  },
): TemplateResult => {
  const rules = (program.rules as AnyRow[] | undefined) ?? []
  const rewards = (program.rewards as AnyRow[] | undefined) ?? []
  const here = `/admin/loyalty/programs/${String(program.id)}`
  const tab = options.tab === 'rules' || options.tab === 'rewards' ? options.tab : 'overview'
  const rulesPane = (
    <Section
      title={_('loyalty_backend.rules.title')}
      description={_('loyalty_backend.rules.hint')}
      body={stack([
        ...(rules.length
          ? [
              dataTable(_, {
                rows: rules,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'priority',
                    label: _('loyalty_backend.field.priority'),
                    cell: (row) => String(row.priority),
                  },
                  {
                    key: 'mode',
                    label: _('loyalty_backend.field.mode'),
                    cell: (row) => labelOf(_, 'trigger', row.mode),
                  },
                  {
                    key: 'points',
                    label: _('loyalty_backend.field.pointAmount'),
                    cell: (row) => String(row.pointAmount),
                  },
                  {
                    key: 'basis',
                    label: _('loyalty_backend.field.pointMode'),
                    cell: (row) => labelOf(_, 'pointMode', row.pointMode),
                  },
                  {
                    key: 'code',
                    label: _('loyalty_backend.field.code'),
                    cell: (row) => code(row.code ? String(row.code) : '—'),
                  },
                  {
                    key: 'state',
                    label: _('loyalty_backend.field.state'),
                    cell: (row) => activeBadge(_, row.active),
                  },
                ],
              }),
            ]
          : []),
        <Surface
          body={
            <RecordForm
              action={here}
              hidden={{ action: 'add-rule' }}
              fields={options.ruleFields}
              submit={_('loyalty_backend.action.addRule')}
              submitVariant="secondary"
            />
          }
        />,
      ])}
    />
  )
  const rewardsPane = (
    <Section
      title={_('loyalty_backend.rewards.title')}
      description={_('loyalty_backend.rewards.hint')}
      body={stack([
        ...(rewards.length
          ? [
              dataTable(_, {
                rows: rewards,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'description',
                    label: _('loyalty_backend.field.description'),
                    cell: (row) => String(row.description),
                    priority: 'primary',
                  },
                  {
                    key: 'type',
                    label: _('loyalty_backend.field.rewardType'),
                    cell: (row) => labelOf(_, 'rewardType', row.rewardType),
                  },
                  {
                    key: 'points',
                    label: _('loyalty_backend.field.requiredPoints'),
                    cell: (row) => String(row.requiredPoints),
                  },
                  {
                    key: 'discount',
                    label: _('loyalty_backend.field.discount'),
                    cell: (row) => String(row.discount),
                  },
                  {
                    key: 'state',
                    label: _('loyalty_backend.field.state'),
                    cell: (row) => activeBadge(_, row.active),
                  },
                ],
              }),
            ]
          : []),
        <Surface
          body={
            <RecordForm
              action={here}
              hidden={{ action: 'add-reward' }}
              fields={options.rewardFields}
              submit={_('loyalty_backend.action.addReward')}
              submitVariant="secondary"
            />
          }
        />,
      ])}
    />
  )
  return (
    <FormScreenFrame
      translator={_}
      title={String(program.name)}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('loyalty_backend.menu.programs')}
          title={String(program.name)}
          subtitle={periodOf(_, program)}
          imageFallback={icon('gift')}
          status={programStateBadge(_, program)}
          badges={[
            badge(labelOf(_, 'programType', program.programType), 'info', String(program.programType)),
            badge(labelOf(_, 'trigger', program.trigger), 'neutral', String(program.trigger)),
          ]}
          summary={[
            {
              id: 'points',
              label: _('loyalty_backend.field.pointName'),
              value: String(program.pointName ?? '—'),
            },
            { id: 'rules', label: _('loyalty_backend.rules.title'), value: rules.length },
            { id: 'rewards', label: _('loyalty_backend.rewards.title'), value: rewards.length },
          ]}
          navigation={
            <Tabs
              label={_('loyalty_backend.program.detail')}
              items={[
                {
                  id: 'overview',
                  label: _('loyalty_backend.tab.overview'),
                  href: here,
                  active: tab === 'overview',
                },
                {
                  id: 'rules',
                  label: _('loyalty_backend.tab.rules'),
                  href: `${here}?tab=rules`,
                  active: tab === 'rules',
                  count: rules.length,
                },
                {
                  id: 'rewards',
                  label: _('loyalty_backend.tab.rewards'),
                  href: `${here}?tab=rewards`,
                  active: tab === 'rewards',
                  count: rewards.length,
                },
              ]}
            />
          }
          controller={
            <RecordActions
              action={here}
              actions={[
                {
                  value: program.active ? 'archive' : 'restore',
                  label: program.active
                    ? _('loyalty_backend.action.archive')
                    : _('loyalty_backend.action.restore'),
                  variant: program.active ? 'destructive' : 'secondary',
                },
              ]}
            />
          }
          body={
            tab === 'rules' ? (
              rulesPane
            ) : tab === 'rewards' ? (
              rewardsPane
            ) : (
              <Section
                title={_('loyalty_backend.program.detail')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={here}
                        hidden={{ action: 'save-program' }}
                        fields={options.programFields}
                        errors={options.errors}
                        submit={_('loyalty_backend.action.save')}
                        submitVariant="primary"
                      />
                    }
                  />
                }
              />
            )
          }
        />
      }
    />
  )
}

/**
 * Every wallet, and how much is sitting in them.
 *
 * The balance total is the number a finance team asks for first — it is a
 * liability, not a statistic — so it sits beside the count rather than under it.
 * Locked and expired are counted apart because an operator undoes them
 * differently.
 */
export const walletsScreen = (
  _: Translator,
  frame: Frame,
  wallets: AnyRow[],
  totals: AnyRow,
  createFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('loyalty_backend.wallets.title')}
    subtitle={_('loyalty_backend.wallets.hint')}
    frame={frame}
    body={stack([
      statRow([
        { id: 'total', label: _('loyalty_backend.stat.wallets'), value: figure(totals.total) },
        { id: 'balance', label: _('loyalty_backend.stat.balance'), value: figure(totals.balance) },
        {
          id: 'active',
          label: _('loyalty_backend.stat.walletsActive'),
          value: figure(totals.active),
          detail: percent(totals.active, totals.total),
          tone: 'positive',
        },
        {
          id: 'locked',
          label: _('loyalty_backend.stat.walletsLocked'),
          value: figure(totals.locked),
          detail: percent(totals.locked, totals.total),
          tone: 'warning',
        },
        {
          id: 'expired',
          label: _('loyalty_backend.stat.walletsExpired'),
          value: figure(totals.expired),
          detail: percent(totals.expired, totals.total),
          tone: 'danger',
        },
      ]),
      wallets.length
        ? dataTable(_, {
            rows: wallets,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'code',
                label: _('loyalty_backend.field.code'),
                cell: (row) =>
                  linkButton({
                    label: String(row.code),
                    href: `/admin/loyalty/wallets/${String(row.id)}`,
                    variant: 'tertiary',
                  }),
                priority: 'primary',
                kind: 'identifier',
              },
              {
                key: 'partner',
                label: _('loyalty_backend.field.partner'),
                cell: (row) => String(row.partnerName ?? '—'),
                kind: 'person',
              },
              {
                key: 'program',
                label: _('loyalty_backend.field.program'),
                cell: (row) =>
                  row.programId
                    ? linkButton({
                        label: String(row.programName ?? row.programId),
                        href: `/admin/loyalty/programs/${String(row.programId)}`,
                        variant: 'tertiary',
                      })
                    : '—',
              },
              {
                key: 'unit',
                label: _('loyalty_backend.field.unit'),
                cell: (row) => badge(labelOf(_, 'walletUnit', row.unit), 'neutral', String(row.unit)),
              },
              {
                key: 'balance',
                label: _('loyalty_backend.field.balance'),
                cell: (row) => figure(row.balance),
                align: 'end',
                kind: 'number',
              },
              // Reserved is money already promised to an order in flight. It is
              // the difference between what the balance says and what the guest
              // can actually spend, so both are shown.
              {
                key: 'available',
                label: _('loyalty_backend.field.available'),
                cell: (row) => figure(row.available),
                align: 'end',
                kind: 'number',
                optional: true,
              },
              {
                key: 'state',
                label: _('loyalty_backend.field.state'),
                cell: (row) => walletStateBadge(_, row),
                kind: 'status',
              },
              {
                key: 'expires',
                label: _('loyalty_backend.field.expiresAt'),
                cell: (row) => (row.expiresAt ? String(row.expiresAt).slice(0, 10) : '—'),
                kind: 'date',
              },
            ],
          })
        : empty(_),
      <Section
        title={_('loyalty_backend.action.createWallet')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/loyalty/wallets"
                fields={createFields}
                errors={errors}
                submit={_('loyalty_backend.action.createWallet')}
                submitVariant="primary"
              />
            }
          />
        }
      />,
    ])}
  />
)

/**
 * One wallet, as the person holding a support ticket about it needs to see it.
 *
 * The balance is three numbers, not one, and the difference between them is
 * usually the reason somebody is looking: `reserved` is points already promised
 * to an order in flight, so a guest told they have a balance and refused at the
 * till is being told about `available`. All three sit in the identity strip.
 *
 * The history is a tab rather than a third section down the page, because for a
 * wallet with a year of activity the adjustment form would otherwise sit below
 * hundreds of rows, out of reach of the person who came here to use it.
 */
export const walletDetailScreen = (
  _: Translator,
  frame: Frame,
  wallet: AnyRow,
  adjustFields: FormField[],
  tab: string,
  errors: string[] = [],
): TemplateResult => {
  const ledger = (wallet.ledger as AnyRow[] | undefined) ?? []
  const here = `/admin/loyalty/wallets/${String(wallet.id)}`
  const showLedger = tab === 'ledger'
  return (
    <FormScreenFrame
      translator={_}
      title={String(wallet.code)}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('loyalty_backend.menu.wallets')}
          title={String(wallet.code)}
          subtitle={wallet.partnerName ? String(wallet.partnerName) : null}
          imageFallback={icon('wallet')}
          status={walletStateBadge(_, wallet)}
          badges={[
            badge(labelOf(_, 'walletUnit', wallet.unit), 'neutral', String(wallet.unit)),
            ...(wallet.programName ? [badge(String(wallet.programName), 'info')] : []),
          ]}
          summary={[
            { id: 'balance', label: _('loyalty_backend.field.balance'), value: figure(wallet.balance) },
            {
              id: 'available',
              label: _('loyalty_backend.field.available'),
              value: figure(wallet.available),
            },
            { id: 'reserved', label: _('loyalty_backend.field.reserved'), value: figure(wallet.reserved) },
          ]}
          navigation={
            <Tabs
              label={_('loyalty_backend.wallets.title')}
              items={[
                {
                  id: 'overview',
                  label: _('loyalty_backend.tab.overview'),
                  href: here,
                  active: !showLedger,
                },
                {
                  id: 'ledger',
                  label: _('loyalty_backend.tab.ledger'),
                  href: `${here}?tab=ledger`,
                  active: showLedger,
                  count: ledger.length,
                },
              ]}
            />
          }
          body={
            showLedger
              ? ledger.length
                ? ledgerTable(_, ledger, { wallet: false })
                : empty(_)
              : stack([
                  <Section
                    title={_('loyalty_backend.wallet.adjust')}
                    description={_('loyalty_backend.wallet.adjustHint')}
                    body={
                      <Surface
                        body={
                          <RecordForm
                            action={here}
                            fields={adjustFields}
                            errors={errors}
                            submit={_('loyalty_backend.action.adjust')}
                            submitVariant="primary"
                          />
                        }
                      />
                    }
                  />,
                  // The last few entries, so the overview says what just
                  // happened without making anyone change tab to find out.
                  <Section
                    title={_('loyalty_backend.wallet.recent')}
                    body={ledger.length ? ledgerTable(_, ledger.slice(0, 5), { wallet: false }) : empty(_)}
                  />,
                ])
          }
          asideLabel={_('loyalty_backend.wallet.about')}
          aside={stack([
            <Section
              title={_('loyalty_backend.wallet.about')}
              body={
                <DefinitionList
                  title={String(wallet.code)}
                  items={[
                    {
                      key: 'program',
                      term: _('loyalty_backend.field.program'),
                      value: String(wallet.programName ?? wallet.programId ?? '—'),
                    },
                    {
                      key: 'partner',
                      term: _('loyalty_backend.field.partner'),
                      value: String(wallet.partnerName ?? '—'),
                    },
                    {
                      key: 'unit',
                      term: _('loyalty_backend.field.unit'),
                      value: labelOf(_, 'walletUnit', wallet.unit),
                    },
                    {
                      key: 'entries',
                      term: _('loyalty_backend.wallet.entries'),
                      value: figure(ledger.length),
                    },
                    {
                      key: 'expires',
                      term: _('loyalty_backend.field.expiresAt'),
                      value: wallet.expiresAt
                        ? String(wallet.expiresAt).slice(0, 10)
                        : _('loyalty_backend.period.always'),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('loyalty_backend.wallet.quickActions')}
              body={
                <Surface
                  body={actionGroup({
                    actions: [
                      linkButton({
                        label: _('loyalty_backend.tab.ledger'),
                        href: `${here}?tab=ledger`,
                        variant: 'secondary',
                      }),
                      // The same wallet's entries beside everyone else's, which is
                      // where a reconciliation question gets answered.
                      linkButton({
                        label: _('loyalty_backend.wallet.inLedger'),
                        href: `/admin/loyalty/ledger?wallet=${encodeURIComponent(String(wallet.id))}&period=all`,
                        variant: 'tertiary',
                      }),
                    ],
                  })}
                />
              }
            />,
          ])}
        />
      }
    />
  )
}

/**
 * The ledger as a statement: what happened, to which wallet, and where it left
 * the balance.
 *
 * Two readers, one table. An operator gets the source key and a link into the
 * wallet; a customer reading their own history gets neither — the source is an
 * internal reference that means nothing to them, and the link goes somewhere
 * they cannot follow. `wallet` drops out on a wallet's own page, where a column
 * repeating the same code twenty times carries no information.
 */
const ledgerTable = (_: Translator, rows: AnyRow[], options: { wallet?: boolean; admin?: boolean } = {}) => {
  const admin = options.admin !== false
  return dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'date',
        label: _('loyalty_backend.field.createdAt'),
        cell: (row) => String(row.createdAt),
        kind: 'date',
        priority: 'primary',
      },
      ...(options.wallet === false
        ? []
        : [
            {
              key: 'wallet',
              label: _('loyalty_backend.field.wallet'),
              cell: (row: AnyRow) =>
                admin && row.walletId
                  ? linkButton({
                      label: String(row.walletCode ?? row.walletId),
                      href: `/admin/loyalty/wallets/${String(row.walletId)}`,
                      variant: 'tertiary',
                    })
                  : code(String(row.walletCode ?? row.walletId ?? '—')),
            },
          ]),
      {
        key: 'operation',
        label: _('loyalty_backend.field.operation'),
        cell: (row) => operationBadge(_, row.operation),
        kind: 'status',
      },
      {
        key: 'description',
        label: _('loyalty_backend.field.description'),
        cell: (row) => String(row.descriptionCode || labelOf(_, 'operation', row.operation)),
      },
      {
        key: 'amount',
        label: _('loyalty_backend.field.amount'),
        cell: (row) => figure(row.amount),
        align: 'end',
        kind: 'number',
      },
      {
        key: 'delta',
        label: _('loyalty_backend.field.balanceDelta'),
        cell: (row) => movement(row.balanceDelta),
        align: 'end',
      },
      ...(admin
        ? [
            {
              key: 'source',
              label: _('loyalty_backend.field.source'),
              // The type is what makes the id meaningful — an order id and a
              // job id look alike — but not every caller carries one, and
              // "undefined:abc" is worse than the id on its own.
              cell: (row: AnyRow) =>
                code(
                  [row.sourceType, row.sourceId ?? '—']
                    .filter((part) => part !== undefined && part !== null)
                    .map(String)
                    .join(':'),
                ),
              priority: 'tertiary' as const,
            },
          ]
        : []),
    ],
  })
}

/**
 * A period of the ledger.
 *
 * It opens with the five figures a statement opens with, because the question
 * asked of a ledger is almost never about one entry: it is what came in, what
 * went out, and where that left the balance. The window, the wallet and the kind
 * of entry are chosen in the chrome above, and every figure here answers under
 * that same filter.
 */
export const ledgerScreen = (_: Translator, frame: Frame, rows: AnyRow[], totals: AnyRow): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('loyalty_backend.ledger.title')}
    subtitle={_('loyalty_backend.ledger.hint')}
    frame={frame}
    body={stack([
      statRow([
        {
          id: 'entries',
          label: _('loyalty_backend.stat.entries'),
          value: figure(totals.entries),
        },
        {
          id: 'credit',
          label: _('loyalty_backend.stat.credit'),
          value: `+${figure(totals.credit)}`,
          tone: 'positive',
        },
        {
          id: 'debit',
          label: _('loyalty_backend.stat.debit'),
          value: figure(totals.debit),
          tone: 'danger',
        },
        {
          id: 'closing',
          label: _('loyalty_backend.stat.closing'),
          value: figure(totals.closing),
        },
        {
          id: 'opening',
          label: _('loyalty_backend.stat.opening'),
          value: figure(totals.opening),
        },
      ]),
      rows.length ? ledgerTable(_, rows) : empty(_),
    ])}
  />
)

/**
 * The membership base, led by what it is worth.
 *
 * Dormant is counted next to active on purpose: a member whose rolling window
 * has emptied is a customer who stopped coming, and that is the number a
 * marketing team acts on. The tiers and the window settings stay on this page
 * below the list, because they are what the numbers above are computed from.
 */
export const membershipsScreen = (
  _: Translator,
  frame: Frame,
  memberships: AnyRow[],
  totals: AnyRow,
  tiers: AnyRow[],
  tierFields: FormField[],
  configFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('loyalty_backend.memberships.title')}
    subtitle={_('loyalty_backend.memberships.hint')}
    frame={frame}
    body={stack([
      statRow([
        { id: 'total', label: _('loyalty_backend.stat.members'), value: figure(totals.total) },
        {
          id: 'active',
          label: _('loyalty_backend.stat.membersActive'),
          value: figure(totals.active),
          detail: percent(totals.active, totals.total),
          tone: 'positive',
        },
        {
          id: 'dormant',
          label: _('loyalty_backend.stat.membersDormant'),
          value: figure(totals.dormant),
          detail: percent(totals.dormant, totals.total),
          tone: 'warning',
        },
        { id: 'points', label: _('loyalty_backend.stat.points'), value: figure(totals.points) },
        { id: 'spend', label: _('loyalty_backend.stat.spend'), value: figure(totals.spend) },
      ]),
      memberships.length ? membersTable(_, memberships) : empty(_),
      <Section
        title={_('loyalty_backend.memberships.config')}
        description={_('loyalty_backend.memberships.windowHint')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/loyalty/memberships"
                hidden={{ action: 'config' }}
                fields={configFields}
                errors={errors}
                submit={_('loyalty_backend.action.saveConfig')}
                submitVariant="primary"
              />
            }
          />
        }
      />,
      <Section
        title={_('loyalty_backend.tiers.title')}
        body={stack([
          ...(tiers.length
            ? [
                dataTable(_, {
                  rows: tiers,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'name',
                      label: _('loyalty_backend.field.name'),
                      cell: (row) => String(row.name),
                      priority: 'primary',
                    },
                    {
                      key: 'code',
                      label: _('loyalty_backend.field.code'),
                      cell: (row) => code(String(row.code)),
                    },
                    {
                      key: 'minimum',
                      label: _('loyalty_backend.field.minimumSpend'),
                      cell: (row) => String(row.minimumSpend),
                      align: 'end',
                    },
                    {
                      key: 'cap',
                      label: _('loyalty_backend.field.redeemPercent'),
                      cell: (row) => `${String(row.redeemPercent)}%`,
                      align: 'end',
                    },
                    {
                      key: 'state',
                      label: _('loyalty_backend.field.state'),
                      cell: (row) => activeBadge(_, row.active),
                    },
                  ],
                }),
              ]
            : []),
          <Surface
            body={
              <RecordForm
                action="/admin/loyalty/memberships"
                hidden={{ action: 'tier' }}
                fields={tierFields}
                submit={_('loyalty_backend.action.addTier')}
                submitVariant="secondary"
              />
            }
          />,
        ])}
      />,
    ])}
  />
)

/**
 * One member per row, ranked by what they have spent in the window.
 *
 * Points and spend are both shown because they answer different questions: spend
 * is what earned the tier, points are what the member can still redeem, and a
 * screen that shows one is regularly asked for the other.
 */
const membersTable = (_: Translator, memberships: AnyRow[]) =>
  dataTable(_, {
    rows: memberships,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'partner',
        label: _('loyalty_backend.field.partner'),
        cell: (row) => String(row.partnerName ?? row.partnerId),
        priority: 'primary',
        kind: 'person',
      },
      {
        key: 'tier',
        label: _('loyalty_backend.field.tier'),
        cell: (row) =>
          row.tierName ? badge(String(row.tierName), 'info', String(row.tierCode ?? row.tierId ?? '')) : '—',
        kind: 'status',
      },
      {
        key: 'points',
        label: _('loyalty_backend.field.points'),
        cell: (row) => figure(row.points),
        align: 'end',
        kind: 'number',
      },
      {
        key: 'spend',
        label: _('loyalty_backend.field.rollingSpend'),
        cell: (row) => figure(row.rollingSpend),
        align: 'end',
        kind: 'number',
      },
      {
        key: 'window',
        label: _('loyalty_backend.field.windowMonths'),
        cell: (row) => _('loyalty_backend.value.months', { count: Number(row.windowMonths ?? 0) }),
        priority: 'tertiary',
      },
      {
        key: 'refreshed',
        label: _('loyalty_backend.field.refreshedAt'),
        cell: (row) => String(row.refreshedAt),
        kind: 'date',
      },
    ],
  })

export const orderLoyaltyScreen = (
  _: Translator,
  frame: Frame,
  options: {
    channel: 'sale' | 'pos'
    orderId: string
    orderName: string
    backHref: string
    result: AnyRow
    errors?: string[]
  },
): TemplateResult => {
  const programs = (options.result.programs as AnyRow[] | undefined) ?? []
  const action = `/admin/loyalty/orders/${options.channel}/${options.orderId}`
  return (
    <RecordScreen
      translator={_}
      title={_('loyalty_backend.order.title', { order: options.orderName })}
      frame={frame}
      body={stack([
        linkButton({
          label: _('loyalty_backend.action.backOrder'),
          href: options.backHref,
          variant: 'tertiary',
        }),
        ...(options.errors?.length
          ? [
              <Notice
                title={_('loyalty_backend.validation.title')}
                message={options.errors.join(' · ')}
                tone="danger"
              />,
            ]
          : []),
        <Section
          title={_('loyalty_backend.order.code')}
          body={
            <Surface
              body={
                <RecordForm
                  action={action}
                  hidden={{ action: 'code' }}
                  fields={[{ name: 'code', label: _('loyalty_backend.field.code'), required: true }]}
                  submit={_('loyalty_backend.action.applyCode')}
                  submitVariant="primary"
                />
              }
            />
          }
        />,
        ...(programs.length
          ? programs.map((program) => {
              const rewards = (program.rewards as AnyRow[] | undefined) ?? []
              return (
                <Section
                  title={String(program.programName)}
                  description={_('loyalty_backend.order.pointsEarned', { points: String(program.points) })}
                  body={stack([
                    ...(program.ineligibleReasons && (program.ineligibleReasons as unknown[]).length
                      ? [
                          <Notice
                            title={_('loyalty_backend.order.ineligible')}
                            message={(program.ineligibleReasons as unknown[]).map(String).join(' · ')}
                            tone="warning"
                          />,
                        ]
                      : []),
                    ...(rewards.length
                      ? [
                          <CardGrid
                            items={rewards}
                            id={(reward) => String(reward.rewardId)}
                            card={(reward) => (
                              <ContentCard
                                title={String(reward.description)}
                                summary={labelOf(_, 'rewardType', reward.rewardType)}
                                body={
                                  <DefinitionList
                                    title={_('loyalty_backend.order.rewardDetails')}
                                    items={[
                                      {
                                        key: 'points',
                                        term: _('loyalty_backend.field.requiredPoints'),
                                        value: String(reward.requiredPoints),
                                      },
                                      {
                                        key: 'discount',
                                        term: _('loyalty_backend.field.discount'),
                                        value: String(reward.discountAmount),
                                      },
                                    ]}
                                  />
                                }
                                actions={
                                  <RecordForm
                                    action={action}
                                    hidden={{
                                      action: 'reward',
                                      programId: String(program.programId),
                                      rewardId: String(reward.rewardId),
                                    }}
                                    fields={[]}
                                    submit={_('loyalty_backend.action.applyReward')}
                                    submitVariant="primary"
                                  />
                                }
                              />
                            )}
                          />,
                        ]
                      : [empty(_)]),
                    <RecordForm
                      action={action}
                      hidden={{ action: 'remove', programId: String(program.programId) }}
                      fields={[]}
                      submit={_('loyalty_backend.action.removeReward')}
                      submitVariant="destructive"
                    />,
                  ])}
                />
              )
            })
          : [empty(_)]),
      ])}
    />
  )
}

export const portalScreen = (_: Translator, frame: Frame, summary: AnyRow): TemplateResult => {
  const membership = (summary.membership as AnyRow | null) ?? null
  const wallets = (summary.wallets as AnyRow[] | undefined) ?? []
  const ledger = (summary.ledger as AnyRow[] | undefined) ?? []
  return (
    <WorkspaceScreen
      translator={_}
      title={_('loyalty_backend.portal.title')}
      frame={frame}
      body={stack([
        ...(membership
          ? [
              <CardGrid
                items={[
                  {
                    id: 'tier',
                    title: _('loyalty_backend.field.tier'),
                    value: String(membership.tierName ?? '—'),
                  },
                  {
                    id: 'points',
                    title: _('loyalty_backend.field.points'),
                    value: String(membership.points),
                  },
                  {
                    id: 'spend',
                    title: _('loyalty_backend.field.rollingSpend'),
                    value: String(membership.rollingSpend),
                  },
                ]}
                id={(item) => item.id}
                card={(item) => (
                  <ContentCard title={item.title} body={<Metric label={item.title} value={item.value} />} />
                )}
              />,
            ]
          : []),
        <Section
          title={_('loyalty_backend.portal.wallets')}
          body={
            wallets.length
              ? dataTable(_, {
                  rows: wallets,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'program',
                      label: _('loyalty_backend.field.program'),
                      cell: (row) => String(row.programName),
                      priority: 'primary',
                    },
                    {
                      key: 'code',
                      label: _('loyalty_backend.field.code'),
                      cell: (row) => code(String(row.code)),
                    },
                    {
                      key: 'balance',
                      label: _('loyalty_backend.field.balance'),
                      cell: (row) => String(row.balance),
                      align: 'end',
                    },
                    {
                      key: 'available',
                      label: _('loyalty_backend.field.available'),
                      cell: (row) => String(row.available),
                      align: 'end',
                    },
                    {
                      key: 'expiry',
                      label: _('loyalty_backend.field.expiresAt'),
                      cell: (row) => String(row.expiresAt ?? '—'),
                      kind: 'date',
                    },
                  ],
                })
              : empty(_)
          }
        />,
        <Section
          title={_('loyalty_backend.portal.history')}
          body={ledger.length ? ledgerTable(_, ledger, { admin: false }) : empty(_)}
        />,
      ])}
    />
  )
}

export const extensionLink = (_: Translator, href: string): JSXChild => (
  <Surface
    tone="subtle"
    body={linkButton({ label: _('loyalty_backend.action.openOrderLoyalty'), href, variant: 'secondary' })}
  />
)
