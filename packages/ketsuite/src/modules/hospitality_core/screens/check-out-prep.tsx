import {
  chargeDescription,
  dataTable,
  dateTime,
  DefinitionList,
  emptyState,
  formatMoney,
  type Frame,
  Notice,
  RecordForm,
  RecordScreen,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export type CheckOutCharge = {
  id: string
  description: string
  type: string
  quantity: string
  amount: string
  occurredAt: string
}

export type CheckOutReadiness = {
  stayId: string
  state: string
  ready: boolean
  roomName?: string | null
  guestName?: string | null
  checkIn?: string | null
  dueOut?: string | null
  late: boolean
  lateReasonRequired: boolean
  folioId?: string | null
  folioState?: string | null
  balance?: string | null
  charges?: CheckOutCharge[]
  awaitingFulfilment?: Array<{ id: string; description: string; quantity: string }>
  blockers?: Array<{ code: string; messageKey: string }>
}

const handover = (_: Translator, data: CheckOutReadiness, locale: string, timezone: string) => (
  <DefinitionList
    title={_('hospitality_core.checkOutPrep.handover')}
    items={[
      { key: 'guest', term: _('hospitality_core.col.guest'), value: data.guestName ?? '—' },
      { key: 'room', term: _('hospitality_core.col.room'), value: data.roomName ?? '—' },
      {
        key: 'check-in',
        term: _('hospitality_core.col.checkIn'),
        value: data.checkIn ? dateTime(data.checkIn, locale, timezone) : '—',
      },
      {
        key: 'due-out',
        term: _('hospitality_core.checkOutPrep.dueOut'),
        value: data.dueOut ? dateTime(data.dueOut, locale, timezone) : '—',
      },
    ]}
  />
)

const chargeTable = (_: Translator, data: CheckOutReadiness, locale: string, timezone: string) => {
  const rows = data.charges ?? []
  if (!rows.length)
    return emptyState(
      _('hospitality_core.checkOutPrep.noCharges'),
      _('hospitality_core.checkOutPrep.noChargesHint'),
    )
  return dataTable(_, {
    rows,
    id: (row: CheckOutCharge) => row.id,
    caption: _('hospitality_core.checkOutPrep.charges'),
    responsive: 'stack',
    columns: [
      {
        key: 'occurred',
        label: _('hospitality_core.folio.charge.occurredAt'),
        cell: (row: CheckOutCharge) => dateTime(row.occurredAt, locale, timezone),
        kind: 'date',
      },
      {
        key: 'description',
        label: _('hospitality_core.folio.charge.description'),
        cell: (row: CheckOutCharge) => chargeDescription(_, row),
        priority: 'primary',
      },
      {
        key: 'quantity',
        label: _('hospitality_core.folio.charge.quantity'),
        cell: (row: CheckOutCharge) => String(row.quantity),
        align: 'end',
        kind: 'number',
      },
      {
        key: 'amount',
        label: _('hospitality_core.col.amount'),
        cell: (row: CheckOutCharge) => formatMoney(_, row.amount),
        align: 'end',
        kind: 'currency',
      },
    ],
  })
}

/**
 * What a departure looks like before anyone presses the button.
 *
 * The desk used to read four screens to answer one question, then press check
 * out and find out from the refusal whether it was allowed. This says it first:
 * who and which room, what is on the bill, what a supplier has not confirmed,
 * and whether the hour needs explaining.
 */
export const checkOutPrepScreen = (
  _: Translator,
  data: CheckOutReadiness,
  reservation: { id: string; code: string },
  locale: string,
  timezone: string,
  frame: Frame,
  permitted: boolean,
  errors: readonly string[] = [],
): TemplateResult => {
  const pending = data.awaitingFulfilment ?? []
  const owes = data.balance != null && Number(data.balance) > 0
  const notices = [
    ...errors.map((message) => (
      <Notice tone="danger" title={message} message={_('hospitality_core.checkOutPrep.blocked')} />
    )),
    ...(data.blockers ?? []).map((blocker) => (
      <Notice
        tone="danger"
        title={_(blocker.messageKey)}
        message={_('hospitality_core.checkOutPrep.blocked')}
      />
    )),
    ...(pending.length
      ? [
          <Notice
            tone="warning"
            title={_('hospitality_core.checkOutPrep.awaiting.title', { count: String(pending.length) })}
            message={_('hospitality_core.checkOutPrep.awaiting.hint')}
          />,
        ]
      : []),
    ...(data.ready
      ? [
          <Notice
            tone={owes ? 'info' : 'positive'}
            title={
              owes
                ? _('hospitality_core.checkOutPrep.owing.title', {
                    amount: formatMoney(_, String(data.balance ?? '0')),
                  })
                : _('hospitality_core.checkOutPrep.ready.title')
            }
            message={_('hospitality_core.checkOutPrep.ready.hint')}
          />,
        ]
      : []),
  ]

  const action = `/admin/hospitality/reservations/${reservation.id}`
  const confirm =
    data.ready && permitted ? (
      <Section
        title={_('hospitality_core.reservation.action.checkOut')}
        description={_('hospitality_core.checkOutPrep.confirmHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.checkOut')}
            submitVariant="primary"
            hidden={{ operation: 'check-out', lang: locale }}
            fields={
              data.lateReasonRequired
                ? [
                    {
                      name: 'lateReason',
                      label: _('hospitality_core.checkOutPrep.lateReason'),
                      type: 'textarea',
                      required: true,
                      help: _('hospitality_core.checkOutPrep.lateReasonHint'),
                    },
                  ]
                : []
            }
          />
        }
      />
    ) : (
      ''
    )

  return (
    <RecordScreen
      translator={_}
      title={_('hospitality_core.checkOutPrep.title', { code: reservation.code })}
      subtitle={_('hospitality_core.checkOutPrep.subtitle')}
      frame={frame}
      body={stack([
        ...notices,
        <Section
          title={_('hospitality_core.checkOutPrep.handover')}
          body={handover(_, data, locale, timezone)}
        />,
        <Section
          title={_('hospitality_core.checkOutPrep.charges')}
          description={
            data.balance != null
              ? _('hospitality_core.checkOutPrep.total', { amount: formatMoney(_, data.balance) })
              : undefined
          }
          body={chargeTable(_, data, locale, timezone)}
        />,
        ...(pending.length
          ? [
              <Section
                title={_('hospitality_core.checkOutPrep.awaiting.title', { count: String(pending.length) })}
                body={dataTable(_, {
                  rows: pending,
                  id: (row: { id: string }) => row.id,
                  caption: _('hospitality_core.checkOutPrep.awaiting.title', {
                    count: String(pending.length),
                  }),
                  responsive: 'stack',
                  columns: [
                    {
                      key: 'description',
                      label: _('hospitality_core.folio.charge.description'),
                      cell: (row: { description: string }) => row.description,
                      priority: 'primary',
                    },
                    {
                      key: 'quantity',
                      label: _('hospitality_core.folio.charge.quantity'),
                      cell: (row: { quantity: string }) => String(row.quantity),
                      align: 'end',
                      kind: 'number',
                    },
                  ],
                })}
              />,
            ]
          : []),
        confirm,
      ])}
    />
  )
}
