import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  type Choice,
  choices,
  dateTime,
  DefinitionList,
  emptyState,
  formatMoney,
  type Frame,
  guestName,
  icon,
  linkButton,
  providerName,
  RecordForm,
  RecordWorkspace,
  type ReservationAmendmentValues,
  type ReservationDetail,
  reservationDetailFeedback,
  type RoomRow,
  Section,
  stack,
  type TemplateResult,
  type Translator,
  workflowTone,
} from './shared.tsx'

export const reservationDetailScreen = (
  _: Translator,
  reservation: ReservationDetail,
  rooms: RoomRow[],
  roomTypes: Choice[],
  partners: Choice[],
  amendment: ReservationAmendmentValues,
  departure: string,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const guest = guestName(reservation)
  const room = reservation.stay?.currentRoom
  const backHref = `/admin/hospitality/reservations?property=${encodeURIComponent(reservation.propertyId)}&lang=${encodeURIComponent(locale)}`
  const action = `/admin/hospitality/reservations/${encodeURIComponent(reservation.id)}?lang=${encodeURIComponent(locale)}`
  const actions: TemplateResult[] = []

  if (reservation.state === 'confirmed' && reservation.provider === 'direct') {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.amend')}
        description={_('hospitality_core.reservation.action.amendHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.amend')}
            submitVariant="secondary"
            hidden={{ operation: 'amend', lang: locale }}
            fields={[
              {
                name: 'partnerId',
                label: _('hospitality_core.reservation.field.guest'),
                type: 'select',
                value: amendment.partnerId,
                options: choices(partners),
                required: true,
              },
              {
                name: 'roomTypeId',
                label: _('hospitality_core.reservation.field.roomType'),
                type: 'select',
                value: amendment.roomTypeId,
                options: choices(roomTypes),
                required: true,
              },
              {
                name: 'checkIn',
                label: _('hospitality_core.col.checkIn'),
                type: 'datetime-local',
                value: amendment.checkIn,
                required: true,
              },
              {
                name: 'checkOut',
                label: _('hospitality_core.col.checkOut'),
                type: 'datetime-local',
                value: amendment.checkOut,
                required: true,
              },
              {
                name: 'adults',
                label: _('hospitality_core.reservation.field.adults'),
                type: 'number',
                value: amendment.adults,
                step: '1',
                required: true,
              },
              {
                name: 'children',
                label: _('hospitality_core.reservation.field.children'),
                type: 'number',
                value: amendment.children,
                step: '1',
                required: true,
              },
              {
                name: 'rate',
                label: _('hospitality_core.reservation.field.rate'),
                type: 'decimal',
                value: amendment.rate,
                required: true,
              },
            ]}
          />
        }
      />,
    )
  }

  if (reservation.state === 'confirmed' && reservation.stayId) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.checkIn')}
        description={_('hospitality_core.reservation.action.checkInHint')}
        body={
          rooms.length ? (
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.checkIn')}
              submitVariant="primary"
              hidden={{ operation: 'check-in', lang: locale }}
              fields={[
                {
                  name: 'roomId',
                  label: _('hospitality_core.reservation.field.room'),
                  type: 'select',
                  required: true,
                  options: rooms.map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.code} · ${candidate.name}`,
                  })),
                },
              ]}
            />
          ) : (
            emptyState(
              _('hospitality_core.reservation.empty.availableRooms'),
              _('hospitality_core.reservation.empty.availableRoomsHint'),
            )
          )
        }
      />,
    )
  }

  if (reservation.state === 'checked_in' && reservation.stayId) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.adjustDeparture')}
        description={_('hospitality_core.reservation.action.adjustDepartureHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.adjustDeparture')}
            submitVariant="secondary"
            hidden={{ operation: 'adjust-departure', lang: locale }}
            fields={[
              {
                name: 'checkOut',
                label: _('hospitality_core.col.checkOut'),
                type: 'datetime-local',
                value: departure,
                required: true,
              },
            ]}
          />
        }
      />,
      <Section
        title={_('hospitality_core.reservation.action.checkOut')}
        description={_('hospitality_core.reservation.action.checkOutHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.checkOut')}
            submitVariant="primary"
            hidden={{ operation: 'check-out', lang: locale }}
            fields={[]}
          />
        }
      />,
    )
  }

  if (reservation.state === 'draft' || reservation.state === 'confirmed') {
    if (reservation.state === 'confirmed')
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.noShow')}
          description={_('hospitality_core.reservation.action.noShowHint')}
          body={
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.noShow')}
              submitVariant="destructive"
              hidden={{ operation: 'no-show', lang: locale }}
              fields={[
                {
                  name: 'reason',
                  label: _('hospitality_core.reservation.field.noShowReason'),
                  type: 'textarea',
                  help: _('hospitality_core.reservation.field.noShowReasonHint'),
                  required: true,
                },
              ]}
            />
          }
        />,
      )
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.cancel')}
        description={_('hospitality_core.reservation.action.cancelHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.cancel')}
            submitVariant="destructive"
            hidden={{ operation: 'cancel', lang: locale }}
            fields={[
              {
                name: 'reason',
                label: _('hospitality_core.reservation.field.cancelReason'),
                type: 'textarea',
                help: _('hospitality_core.reservation.field.cancelReasonHint'),
              },
            ]}
          />
        }
      />,
    )
  }

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.reservation.detail.title', { code: reservation.code })}
      frame={frame}
      body={stack([
        reservationDetailFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.reservation.detail.kicker')}
          title={reservation.code}
          subtitle={guest}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(`hospitality_core.reservationState.${reservation.state}`),
              workflowTone(reservation.state),
              reservation.state,
            ),
            badge(providerName(_, reservation.provider), 'neutral'),
          ]}
          summary={[
            {
              id: 'room-type',
              label: _('hospitality_core.col.roomType'),
              value: reservation.roomType?.name ?? reservation.roomTypeId,
            },
            {
              id: 'guests',
              label: _('hospitality_core.col.guests'),
              value: reservation.adults + reservation.children,
            },
            {
              id: 'total',
              label: _('hospitality_core.col.amount'),
              value: formatMoney(_, reservation.amountTotal),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.reservation.action.back'),
            href: backHref,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.reservation.detail.stay')}
              description={_('hospitality_core.reservation.detail.stayHint')}
              body={
                <DefinitionList
                  title={reservation.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest,
                    },
                    {
                      key: 'room',
                      term: _('hospitality_core.reservation.field.room'),
                      value: room?.name ?? room?.code ?? _('hospitality_core.reservation.value.unassigned'),
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.col.checkIn'),
                      value: dateTime(reservation.checkIn, locale, timezone),
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.col.checkOut'),
                      value: dateTime(reservation.checkOut, locale, timezone),
                    },
                    {
                      key: 'booking-type',
                      term: _('hospitality_core.reservation.field.bookingType'),
                      value: _(`hospitality_core.bookingType.${reservation.bookingType}`),
                    },
                    {
                      key: 'billing',
                      term: _('hospitality_core.reservation.field.billingMode'),
                      value: _(`hospitality_core.billing.${reservation.billingMode}`),
                    },
                    {
                      key: 'rate',
                      term: _('hospitality_core.reservation.field.rate'),
                      value: formatMoney(_, reservation.rate),
                    },
                    {
                      key: 'quantity',
                      term: _('hospitality_core.reservation.quote.quantity'),
                      value: String(reservation.quantity),
                    },
                    {
                      key: 'folio',
                      term: _('hospitality_core.reservation.field.folio'),
                      value: reservation.folio?.code ?? reservation.folioId,
                    },
                    ...(reservation.cancelReason
                      ? [
                          {
                            key: 'cancel-reason',
                            term: _('hospitality_core.reservation.field.cancelReason'),
                            value: reservation.cancelReason,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}
