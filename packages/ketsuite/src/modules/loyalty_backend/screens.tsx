import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  code,
  ContentCard,
  dataTable,
  DefinitionList,
  emptyState,
  Framed,
  linkButton,
  Metric,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { selectionLabel } from '../backend/screen.ts'

type AnyRow = Record<string, unknown>

const empty = (_: Translator) => emptyState(_('loyalty_backend.empty.title'), _('loyalty_backend.empty.hint'))

/** A stable loyalty code in the reader's language; the code itself survives as data. */
const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'loyalty_backend', group, value)

const activeBadge = (_: Translator, active: unknown) =>
  active
    ? badge(_('loyalty_backend.state.active'), 'positive', 'active')
    : badge(_('loyalty_backend.state.archived'), 'neutral', 'archived')

export const dashboardScreen = (
  _: Translator,
  frame: Frame,
  stats: { programs: number; wallets: number; members: number; ledger: number },
): TemplateResult => (
  <Framed
    translator={_}
    title={_('loyalty_backend.dashboard.title')}
    frame={frame}
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
        card={(item) => (
          <ContentCard
            title={item.title}
            href={item.href}
            body={<Metric label={_('loyalty_backend.dashboard.records')} value={String(item.value)} />}
          />
        )}
      />,
      <Notice
        title={_('loyalty_backend.dashboard.ledgerTitle')}
        message={_('loyalty_backend.dashboard.ledgerHint')}
        tone="info"
      />,
    ])}
  />
)

export const programsScreen = (
  _: Translator,
  frame: Frame,
  programs: AnyRow[],
  createFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('loyalty_backend.programs.title')}
    frame={frame}
    body={stack([
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
      />,
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
                cell: (row) => labelOf(_, 'programType', row.programType),
              },
              {
                key: 'trigger',
                label: _('loyalty_backend.field.trigger'),
                cell: (row) => labelOf(_, 'trigger', row.trigger),
              },
              {
                key: 'scope',
                label: _('loyalty_backend.field.availableOn'),
                cell: (row) =>
                  [
                    row.availableSale && _('loyalty_backend.channel.sale'),
                    row.availablePos && _('loyalty_backend.channel.pos'),
                  ]
                    .filter(Boolean)
                    .join(' · '),
              },
              {
                key: 'state',
                label: _('loyalty_backend.field.state'),
                cell: (row) => activeBadge(_, row.active),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const programDetailScreen = (
  _: Translator,
  frame: Frame,
  program: AnyRow,
  options: {
    programFields: FormField[]
    ruleFields: FormField[]
    rewardFields: FormField[]
    errors?: string[]
  },
): TemplateResult => {
  const rules = (program.rules as AnyRow[] | undefined) ?? []
  const rewards = (program.rewards as AnyRow[] | undefined) ?? []
  return (
    <Framed
      translator={_}
      title={String(program.name)}
      frame={frame}
      body={stack([
        <CardGrid
          items={[
            {
              id: 'type',
              title: _('loyalty_backend.field.programType'),
              value: labelOf(_, 'programType', program.programType),
            },
            {
              id: 'points',
              title: _('loyalty_backend.field.pointName'),
              value: String(program.pointName),
            },
            {
              id: 'rules',
              title: _('loyalty_backend.rules.title'),
              value: String(rules.length),
            },
            {
              id: 'rewards',
              title: _('loyalty_backend.rewards.title'),
              value: String(rewards.length),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.title} body={<Metric label={item.title} value={item.value} />} />
          )}
        />,
        <Notice
          title={_('loyalty_backend.field.state')}
          message={program.active ? _('loyalty_backend.state.active') : _('loyalty_backend.state.archived')}
          tone={program.active ? 'positive' : 'warning'}
        />,
        <Surface
          body={
            <RecordActions
              action={`/admin/loyalty/programs/${String(program.id)}`}
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
        />,
        <Section
          title={_('loyalty_backend.program.detail')}
          body={
            <Surface
              body={
                <RecordForm
                  action={`/admin/loyalty/programs/${String(program.id)}`}
                  hidden={{ action: 'save-program' }}
                  fields={options.programFields}
                  errors={options.errors}
                  submit={_('loyalty_backend.action.save')}
                  submitVariant="primary"
                />
              }
            />
          }
        />,
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
                  action={`/admin/loyalty/programs/${String(program.id)}`}
                  hidden={{ action: 'add-rule' }}
                  fields={options.ruleFields}
                  submit={_('loyalty_backend.action.addRule')}
                  submitVariant="secondary"
                />
              }
            />,
          ])}
        />,
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
                  action={`/admin/loyalty/programs/${String(program.id)}`}
                  hidden={{ action: 'add-reward' }}
                  fields={options.rewardFields}
                  submit={_('loyalty_backend.action.addReward')}
                  submitVariant="secondary"
                />
              }
            />,
          ])}
        />,
      ])}
    />
  )
}

export const walletsScreen = (
  _: Translator,
  frame: Frame,
  wallets: AnyRow[],
  createFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('loyalty_backend.wallets.title')}
    frame={frame}
    body={stack([
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
      />,
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
              },
              {
                key: 'partner',
                label: _('loyalty_backend.field.partner'),
                cell: (row) => String(row.partnerName ?? '—'),
              },
              {
                key: 'balance',
                label: _('loyalty_backend.field.balance'),
                cell: (row) => String(row.balance),
                align: 'end',
              },
              {
                key: 'reserved',
                label: _('loyalty_backend.field.reserved'),
                cell: (row) => String(row.reserved),
                align: 'end',
              },
              {
                key: 'available',
                label: _('loyalty_backend.field.available'),
                cell: (row) => String(row.available),
                align: 'end',
              },
              {
                key: 'state',
                label: _('loyalty_backend.field.state'),
                cell: (row) => activeBadge(_, row.active),
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const walletDetailScreen = (
  _: Translator,
  frame: Frame,
  wallet: AnyRow,
  adjustFields: FormField[],
  errors: string[] = [],
): TemplateResult => {
  const ledger = (wallet.ledger as AnyRow[] | undefined) ?? []
  return (
    <Framed
      translator={_}
      title={String(wallet.code)}
      frame={frame}
      body={stack([
        <CardGrid
          items={[
            { id: 'balance', title: _('loyalty_backend.field.balance'), value: String(wallet.balance) },
            { id: 'reserved', title: _('loyalty_backend.field.reserved'), value: String(wallet.reserved) },
            { id: 'available', title: _('loyalty_backend.field.available'), value: String(wallet.available) },
            {
              id: 'unit',
              title: _('loyalty_backend.field.unit'),
              value: labelOf(_, 'walletUnit', wallet.unit),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.title} body={<Metric label={item.title} value={item.value} />} />
          )}
        />,
        <Section
          title={_('loyalty_backend.wallet.adjust')}
          body={
            <Surface
              body={
                <RecordForm
                  action={`/admin/loyalty/wallets/${String(wallet.id)}`}
                  fields={adjustFields}
                  errors={errors}
                  submit={_('loyalty_backend.action.adjust')}
                  submitVariant="secondary"
                />
              }
            />
          }
        />,
        <Section
          title={_('loyalty_backend.ledger.title')}
          body={ledger.length ? ledgerTable(_, ledger) : empty(_)}
        />,
      ])}
    />
  )
}

const ledgerTable = (_: Translator, rows: AnyRow[]) =>
  dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'date',
        label: _('loyalty_backend.field.createdAt'),
        cell: (row) => String(row.createdAt),
        kind: 'date',
      },
      {
        key: 'wallet',
        label: _('loyalty_backend.field.wallet'),
        cell: (row) => code(String(row.walletCode ?? row.walletId)),
      },
      {
        key: 'operation',
        label: _('loyalty_backend.field.operation'),
        cell: (row) => labelOf(_, 'operation', row.operation),
      },
      {
        key: 'amount',
        label: _('loyalty_backend.field.amount'),
        cell: (row) => String(row.amount),
        align: 'end',
      },
      {
        key: 'delta',
        label: _('loyalty_backend.field.balanceDelta'),
        cell: (row) => String(row.balanceDelta),
        align: 'end',
      },
      { key: 'source', label: _('loyalty_backend.field.source'), cell: (row) => String(row.sourceId) },
    ],
  })

export const ledgerScreen = (_: Translator, frame: Frame, rows: AnyRow[]): TemplateResult => (
  <Framed
    translator={_}
    title={_('loyalty_backend.ledger.title')}
    frame={frame}
    body={rows.length ? ledgerTable(_, rows) : empty(_)}
  />
)

export const membershipsScreen = (
  _: Translator,
  frame: Frame,
  memberships: AnyRow[],
  tiers: AnyRow[],
  tierFields: FormField[],
  configFields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('loyalty_backend.memberships.title')}
    frame={frame}
    body={stack([
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
      <Section
        title={_('loyalty_backend.memberships.members')}
        body={
          memberships.length
            ? dataTable(_, {
                rows: memberships,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'partner',
                    label: _('loyalty_backend.field.partner'),
                    cell: (row) => String(row.partnerName ?? row.partnerId),
                    priority: 'primary',
                  },
                  {
                    key: 'tier',
                    label: _('loyalty_backend.field.tier'),
                    cell: (row) => String(row.tierName ?? '—'),
                  },
                  {
                    key: 'spend',
                    label: _('loyalty_backend.field.rollingSpend'),
                    cell: (row) => String(row.rollingSpend),
                    align: 'end',
                  },
                  {
                    key: 'points',
                    label: _('loyalty_backend.field.points'),
                    cell: (row) => String(row.points),
                    align: 'end',
                  },
                  {
                    key: 'refreshed',
                    label: _('loyalty_backend.field.refreshedAt'),
                    cell: (row) => String(row.refreshedAt),
                    kind: 'date',
                  },
                ],
              })
            : empty(_)
        }
      />,
    ])}
  />
)

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
    <Framed
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
    <Framed
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
          body={ledger.length ? ledgerTable(_, ledger) : empty(_)}
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
