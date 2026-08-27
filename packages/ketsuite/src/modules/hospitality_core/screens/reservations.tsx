import { ListScreenFrame } from './page-frame.tsx'
import {
  CardGrid,
  type Choice,
  choices,
  dataTable,
  emptyState,
  formatMoney,
  type Frame,
  linkButton,
  Metric,
  modalSheet,
  modalWorkspace,
  RecordForm,
  reservationColumns,
  reservationFeedback,
  type ReservationIntakeValues,
  type ReservationQuote,
  type ReservationRow,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

type ReservationModalOptions = {
  open: boolean
  createHref: string
  closeHref: string
  action: string
}

export const reservationsScreen = (
  _: Translator,
  data: {
    rows: ReservationRow[]
    properties: Choice[]
    roomTypes: Choice[]
    partners: Choice[]
    values: ReservationIntakeValues
    quote?: ReservationQuote | null
  },
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  modal?: ReservationModalOptions,
): TemplateResult => {
  const errors = (data.quote?.errors ?? []).map((error) =>
    error.messageKey ? _(error.messageKey, error.params) : _('hospitality_core.feedback.invalid'),
  )
  const quote = data.quote?.ok ? data.quote : null
  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.reservations.title')}
      frame={frame}
      actions={linkButton({
        label: _('hospitality_core.reservation.section.intake'),
        href: modal?.createHref ?? '/admin/hospitality/reservations?create=1',
        variant: 'primary',
      })}
      body={stack([
        reservationFeedback(_, status),
        <RecordForm
          action="/admin/hospitality/reservations"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.reservation.field.property'),
              type: 'select',
              value: data.values.propertyId,
              options: choices(data.properties),
              required: true,
            },
          ]}
        />,
        <Section
          title={_('hospitality_core.reservation.section.list')}
          description={_('hospitality_core.reservation.section.listHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: reservationColumns(_, locale, timezone),
                  rows: data.rows,
                  id: (row) => row.id,
                })
              : emptyState(
                  _('hospitality_core.screen.reservations.empty'),
                  _('hospitality_core.screen.reservations.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
  if (!modal?.open) return list

  const intake =
    data.roomTypes.length && data.partners.length ? (
      <RecordForm
        action={modal.action}
        method="post"
        submit={_('hospitality_core.reservation.action.quote')}
        submitVariant="primary"
        errors={errors}
        hidden={{
          operation: 'quote',
          lang: locale,
          property: data.values.propertyId,
          id: data.values.id,
        }}
        fields={[
          {
            name: 'code',
            label: _('hospitality_core.reservation.field.code'),
            value: data.values.code,
            help: _('hospitality_core.reservation.field.codeHint'),
          },
          {
            name: 'partnerId',
            label: _('hospitality_core.reservation.field.guest'),
            type: 'select',
            value: data.values.partnerId,
            options: [
              { value: '', label: _('hospitality_core.reservation.value.selectGuest') },
              ...choices(data.partners),
            ],
            required: true,
          },
          {
            name: 'roomTypeId',
            label: _('hospitality_core.reservation.field.roomType'),
            type: 'select',
            value: data.values.roomTypeId,
            options: choices(data.roomTypes),
            required: true,
          },
          {
            name: 'bookingType',
            label: _('hospitality_core.reservation.field.bookingType'),
            type: 'select',
            value: data.values.bookingType,
            options: ['nightly', 'weekly', 'monthly'].map((value) => ({
              value,
              label: _(`hospitality_core.bookingType.${value}`),
            })),
            required: true,
          },
          {
            name: 'checkIn',
            label: _('hospitality_core.col.checkIn'),
            type: 'datetime-local',
            value: data.values.checkIn,
            required: true,
          },
          {
            name: 'checkOut',
            label: _('hospitality_core.col.checkOut'),
            type: 'datetime-local',
            value: data.values.checkOut,
            required: true,
          },
          {
            name: 'adults',
            label: _('hospitality_core.reservation.field.adults'),
            type: 'number',
            value: data.values.adults,
            required: true,
            step: '1',
          },
          {
            name: 'children',
            label: _('hospitality_core.reservation.field.children'),
            type: 'number',
            value: data.values.children,
            required: true,
            step: '1',
          },
          {
            name: 'rate',
            label: _('hospitality_core.reservation.field.rate'),
            type: 'decimal',
            value: data.values.rate,
            help: _('hospitality_core.reservation.field.rateHint'),
          },
        ]}
      />
    ) : (
      emptyState(
        data.roomTypes.length
          ? _('hospitality_core.reservation.empty.partners')
          : _('hospitality_core.reservation.empty.roomTypes'),
        data.roomTypes.length
          ? _('hospitality_core.reservation.empty.partnersHint')
          : _('hospitality_core.reservation.empty.roomTypesHint'),
      )
    )

  return modalWorkspace(
    list,
    modalSheet({
      id: 'hospitality-reservation-create',
      title: _('hospitality_core.reservation.section.intake'),
      description: _('hospitality_core.reservation.section.intakeHint'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      size: 'large',
      body: stack([
        intake,
        quote ? (
          <Section
            title={_('hospitality_core.reservation.section.quote')}
            description={_('hospitality_core.reservation.section.quoteHint')}
            body={stack([
              <CardGrid
                items={[
                  {
                    id: 'rate',
                    label: _('hospitality_core.reservation.quote.rate'),
                    value: formatMoney(_, quote.rate ?? 0),
                  },
                  {
                    id: 'quantity',
                    label: _('hospitality_core.reservation.quote.quantity'),
                    value: String(quote.quantity ?? 0),
                  },
                  {
                    id: 'availability',
                    label: _('hospitality_core.reservation.quote.availability'),
                    value: String(quote.minimumAvailable ?? 0),
                  },
                  {
                    id: 'total',
                    label: _('hospitality_core.reservation.quote.total'),
                    value: formatMoney(_, quote.amountTotal ?? 0),
                  },
                ]}
                id={(item) => item.id}
                card={(item) => <Metric label={item.label} value={item.value} tone={item.id} />}
              />,
              <RecordForm
                action={modal.action}
                method="post"
                submit={_('hospitality_core.reservation.action.create')}
                submitVariant="primary"
                hidden={{
                  operation: 'create',
                  lang: locale,
                  property: data.values.propertyId,
                  id: data.values.id,
                  code: data.values.code,
                  partnerId: data.values.partnerId,
                  roomTypeId: data.values.roomTypeId,
                  bookingType: data.values.bookingType,
                  checkIn: data.values.checkIn,
                  checkOut: data.values.checkOut,
                  adults: String(data.values.adults),
                  children: String(data.values.children),
                  rate: String(quote.rate ?? ''),
                }}
                fields={[]}
              />,
            ])}
          />
        ) : null,
      ]),
    }),
  )
}
