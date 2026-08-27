import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  type Choice,
  choices,
  dataTable,
  dateTime,
  DefinitionList,
  DOCUMENT_TYPES,
  emptyState,
  formatMoney,
  type Frame,
  GENDERS,
  guestDocumentColumns,
  type GuestDocumentRow,
  guestName,
  icon,
  linkButton,
  Notice,
  RecordForm,
  RecordWorkspace,
  type RoomRow,
  Section,
  stack,
  stayAssignmentColumns,
  stayDetailFeedback,
  stayGuestColumns,
  type StayGuestRow,
  type StayRow,
  type TemplateResult,
  type Translator,
  workflowTone,
} from './shared.tsx'

export const stayDetailScreen = (
  _: Translator,
  stay: StayRow,
  rooms: RoomRow[],
  partners: Choice[],
  documents: GuestDocumentRow[],
  documentId: string,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const guest = guestName(stay)
  const action = `/admin/hospitality/stays/${encodeURIComponent(stay.id)}?lang=${encodeURIComponent(locale)}`
  const roomNames = new Map(rooms.map((room) => [room.id, `${room.code} · ${room.name}`]))
  const assignments = (stay.assignments ?? []).map((assignment) => ({
    ...assignment,
    roomName: roomNames.get(assignment.roomId) ?? assignment.roomId,
  }))
  const guests = stay.guests ?? []
  const registeredGuests = guests.filter(
    (registered): registered is StayGuestRow & { partnerId: string } => !!registered.partnerId,
  )
  const availableRooms = rooms.filter(
    (room) => room.active && room.status === 'available' && room.id !== stay.currentRoomId,
  )

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.stay.detail.title', { code: stay.code })}
      frame={frame}
      body={stack([
        stayDetailFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.stay.detail.kicker')}
          title={stay.code}
          subtitle={guest}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.stayState.${stay.state}`), workflowTone(stay.state), stay.state),
            badge(_(`hospitality_core.bookingType.${stay.bookingType}`), 'neutral'),
          ]}
          summary={[
            {
              id: 'room',
              label: _('hospitality_core.stay.field.room'),
              value:
                stay.currentRoom?.name ??
                stay.currentRoom?.code ??
                _('hospitality_core.reservation.value.unassigned'),
            },
            {
              id: 'guests',
              label: _('hospitality_core.col.guests'),
              value: guests.length,
            },
            {
              id: 'rate',
              label: _('hospitality_core.reservation.field.rate'),
              value: formatMoney(_, stay.rate),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.stay.action.back'),
            href: `/admin/hospitality/stays?property=${encodeURIComponent(stay.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.stay.section.information')}
              description={_('hospitality_core.stay.section.informationHint')}
              body={
                <DefinitionList
                  title={stay.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest,
                    },
                    {
                      key: 'room-type',
                      term: _('hospitality_core.col.roomType'),
                      value: stay.roomType?.name ?? stay.roomTypeId,
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.col.checkIn'),
                      value: dateTime(stay.checkIn, locale, timezone),
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.col.checkOut'),
                      value: dateTime(stay.checkOut, locale, timezone),
                    },
                    {
                      key: 'billing',
                      term: _('hospitality_core.reservation.field.billingMode'),
                      value: _(`hospitality_core.billing.${stay.billingMode}`),
                    },
                    ...(stay.nextBillDate
                      ? [
                          {
                            key: 'next-bill',
                            term: _('hospitality_core.stay.field.nextBillDate'),
                            value: stay.nextBillDate,
                          },
                        ]
                      : []),
                    {
                      key: 'folio',
                      term: _('hospitality_core.reservation.field.folio'),
                      value: stay.folioId,
                    },
                    ...(stay.reservationId
                      ? [
                          {
                            key: 'reservation',
                            term: _('hospitality_core.stay.field.reservation'),
                            value: stay.reservation?.code ?? stay.reservationId,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.stay.section.assignments')}
              description={_('hospitality_core.stay.section.assignmentsHint')}
              body={stack([
                assignments.length
                  ? dataTable(_, {
                      columns: stayAssignmentColumns(_, locale, timezone),
                      rows: assignments,
                      id: (assignment) => assignment.id,
                    })
                  : emptyState(
                      _('hospitality_core.stay.empty.assignments'),
                      _('hospitality_core.stay.empty.assignmentsHint'),
                    ),
                stay.state === 'checked_in' ? (
                  availableRooms.length ? (
                    <RecordForm
                      action={action}
                      method="post"
                      submit={_('hospitality_core.stay.action.moveRoom')}
                      submitVariant="secondary"
                      hidden={{ operation: 'move-room', lang: locale }}
                      fields={[
                        {
                          name: 'roomId',
                          label: _('hospitality_core.stay.field.newRoom'),
                          type: 'select',
                          required: true,
                          options: availableRooms.map((room) => ({
                            value: room.id,
                            label: `${room.code} · ${room.name} · ${room.roomType?.name ?? room.roomTypeId}`,
                          })),
                        },
                        {
                          name: 'reason',
                          label: _('hospitality_core.stay.field.moveReason'),
                          type: 'textarea',
                          required: true,
                          help: _('hospitality_core.stay.field.moveReasonHint'),
                        },
                      ]}
                    />
                  ) : (
                    <Notice
                      title={_('hospitality_core.stay.empty.availableRooms')}
                      message={_('hospitality_core.stay.empty.availableRoomsHint')}
                      tone="warning"
                    />
                  )
                ) : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.stay.section.guests')}
              description={_('hospitality_core.stay.section.guestsHint')}
              body={stack([
                guests.length
                  ? dataTable(_, { columns: stayGuestColumns(_), rows: guests, id: (row) => row.id })
                  : emptyState(
                      _('hospitality_core.stay.empty.guests'),
                      _('hospitality_core.stay.empty.guestsHint'),
                    ),
                stay.state === 'draft' || stay.state === 'checked_in' ? (
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.stay.action.addGuest')}
                    submitVariant="secondary"
                    hidden={{ operation: 'add-guest', lang: locale }}
                    fields={[
                      {
                        name: 'displayName',
                        label: _('hospitality_core.stay.field.guestName'),
                        required: true,
                      },
                      {
                        name: 'partnerId',
                        label: _('hospitality_core.stay.field.linkedPartner'),
                        type: 'select',
                        options: [
                          { value: '', label: _('hospitality_core.stay.value.noLinkedPartner') },
                          ...choices(partners),
                        ],
                        help: _('hospitality_core.stay.field.linkedPartnerHint'),
                      },
                    ]}
                  />
                ) : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.stay.section.documents')}
              description={_('hospitality_core.stay.section.documentsHint')}
              body={stack([
                documents.length
                  ? dataTable(_, {
                      columns: guestDocumentColumns(_),
                      rows: documents,
                      id: (row) => row.id,
                    })
                  : emptyState(
                      _('hospitality_core.stay.empty.documents'),
                      _('hospitality_core.stay.empty.documentsHint'),
                    ),
                stay.state !== 'cancelled' ? (
                  registeredGuests.length ? (
                    <RecordForm
                      action={action}
                      method="post"
                      submit={_('hospitality_core.stay.action.saveDocument')}
                      submitVariant="secondary"
                      hidden={{
                        operation: 'save-document',
                        documentId,
                        lang: locale,
                      }}
                      fields={[
                        {
                          name: 'partnerId',
                          label: _('hospitality_core.stay.document.guest'),
                          type: 'select',
                          required: true,
                          options: registeredGuests.map((registered) => ({
                            value: registered.partnerId,
                            label: registered.displayName,
                          })),
                        },
                        {
                          name: 'type',
                          label: _('hospitality_core.stay.document.type'),
                          type: 'select',
                          required: true,
                          value: 'cccd',
                          options: DOCUMENT_TYPES.map((value) => ({
                            value,
                            label: _(`hospitality_core.document.${value}`),
                          })),
                        },
                        {
                          name: 'number',
                          label: _('hospitality_core.stay.document.number'),
                          required: true,
                          help: _('hospitality_core.stay.document.numberHint'),
                        },
                        {
                          name: 'fullName',
                          label: _('hospitality_core.stay.document.fullName'),
                          required: true,
                          value: registeredGuests[0]?.displayName ?? '',
                        },
                        {
                          name: 'dateOfBirth',
                          label: _('hospitality_core.stay.document.dateOfBirth'),
                          type: 'date',
                          required: true,
                        },
                        {
                          name: 'gender',
                          label: _('hospitality_core.stay.document.gender'),
                          type: 'select',
                          options: [
                            { value: '', label: _('hospitality_core.stay.document.genderUnknown') },
                            ...GENDERS.map((value) => ({
                              value,
                              label: _(`hospitality_core.gender.${value}`),
                            })),
                          ],
                        },
                        {
                          name: 'nationality',
                          label: _('hospitality_core.stay.document.nationality'),
                          value: 'VN',
                          help: _('hospitality_core.stay.document.nationalityHint'),
                        },
                        {
                          name: 'permanentAddress',
                          label: _('hospitality_core.stay.document.permanentAddress'),
                          type: 'textarea',
                        },
                        {
                          name: 'issueDate',
                          label: _('hospitality_core.stay.document.issueDate'),
                          type: 'date',
                        },
                        {
                          name: 'issuePlace',
                          label: _('hospitality_core.stay.document.issuePlace'),
                        },
                      ]}
                    />
                  ) : (
                    <Notice
                      title={_('hospitality_core.stay.empty.documentGuests')}
                      message={_('hospitality_core.stay.empty.documentGuestsHint')}
                      tone="warning"
                    />
                  )
                ) : null,
              ])}
            />,
          ])}
        />,
      ])}
    />
  )
}
