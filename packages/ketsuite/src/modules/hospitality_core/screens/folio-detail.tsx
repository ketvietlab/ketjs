import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  CHARGE_TYPES,
  dataTable,
  dateTime,
  DefinitionList,
  emptyState,
  folioChargeColumns,
  folioDetailFeedback,
  type FolioRow,
  folioStayColumns,
  formatMoney,
  type Frame,
  icon,
  linkButton,
  Notice,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  type TemplateResult,
  type Translator,
  workflowTone,
} from './shared.tsx'

const MANUAL_CHARGE_TYPES = CHARGE_TYPES.filter((type) => type !== 'minibar')

export const folioDetailScreen = (
  _: Translator,
  folio: FolioRow,
  locale: string,
  timezone: string,
  frame: Frame,
  chargeId: string,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const stays = folio.stays ?? []
  const charges = folio.charges ?? []
  const activeCharges = charges.filter((charge) => charge.state === 'active')
  const staysById = new Map(stays.map((stay) => [stay.id, stay]))
  const guest = folio.partner?.name ?? folio.partnerId
  const action = `/admin/hospitality/folios/${encodeURIComponent(folio.id)}?lang=${encodeURIComponent(locale)}`

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.folio.detail.title', { code: folio.code })}
      frame={frame}
      body={stack([
        folioDetailFeedback(_, status, errors),
        <Notice
          title={_('hospitality_core.folio.notice.operational')}
          message={_('hospitality_core.folio.notice.operationalHint')}
          tone="info"
        />,
        <RecordWorkspace
          kicker={_('hospitality_core.folio.detail.kicker')}
          title={folio.code}
          subtitle={guest}
          imageFallback={icon('receipt-text')}
          badges={[
            badge(_(`hospitality_core.folioState.${folio.state}`), workflowTone(folio.state), folio.state),
          ]}
          summary={[
            {
              id: 'amount',
              label: _('hospitality_core.folio.metric.activeTotal'),
              value: formatMoney(_, folio.amountTotal),
            },
            {
              id: 'charges',
              label: _('hospitality_core.folio.metric.activeCharges'),
              value: activeCharges.length,
            },
            {
              id: 'stays',
              label: _('hospitality_core.col.stays'),
              value: stays.length,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.folio.action.back'),
            href: `/admin/hospitality/folios?property=${encodeURIComponent(folio.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.folio.section.information')}
              description={_('hospitality_core.folio.section.informationHint')}
              body={
                <DefinitionList
                  title={folio.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.col.guest'),
                      value: guest,
                    },
                    {
                      key: 'opened',
                      term: _('hospitality_core.folio.field.openedAt'),
                      value: dateTime(folio.openedAt, locale, timezone),
                    },
                    ...(folio.closedAt
                      ? [
                          {
                            key: 'closed',
                            term: _('hospitality_core.folio.field.closedAt'),
                            value: dateTime(folio.closedAt, locale, timezone),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.folio.section.charges')}
              description={_('hospitality_core.folio.section.chargesHint')}
              body={stack([
                charges.length
                  ? dataTable(_, {
                      columns: folioChargeColumns(_, locale, timezone, staysById),
                      rows: charges,
                      id: (charge) => charge.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.charges'),
                      _('hospitality_core.folio.empty.chargesHint'),
                    ),
                folio.state === 'open' ? (
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.postCharge')}
                    submitVariant="secondary"
                    hidden={{ operation: 'post-charge', id: chargeId, lang: locale }}
                    fields={[
                      {
                        name: 'stayId',
                        label: _('hospitality_core.folio.charge.stay'),
                        type: 'select',
                        options: [
                          { value: '', label: _('hospitality_core.folio.value.noStay') },
                          ...stays.map((stay) => ({ value: stay.id, label: stay.code })),
                        ],
                      },
                      {
                        name: 'description',
                        label: _('hospitality_core.folio.charge.description'),
                        required: true,
                      },
                      {
                        name: 'type',
                        label: _('hospitality_core.folio.charge.type'),
                        type: 'select',
                        required: true,
                        value: 'service',
                        options: MANUAL_CHARGE_TYPES.map((type) => ({
                          value: type,
                          label: _(`hospitality_core.charge.${type}`),
                        })),
                      },
                      {
                        name: 'quantity',
                        label: _('hospitality_core.folio.charge.quantity'),
                        type: 'decimal',
                        value: '1',
                        step: '0.01',
                        required: true,
                      },
                      {
                        name: 'unitPrice',
                        label: _('hospitality_core.folio.charge.unitPrice'),
                        type: 'decimal',
                        step: '0.01',
                        required: true,
                      },
                    ]}
                  />
                ) : null,
              ])}
            />,
            activeCharges.length && folio.state === 'open' ? (
              <Section
                title={_('hospitality_core.folio.section.correction')}
                description={_('hospitality_core.folio.section.correctionHint')}
                body={
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.voidCharge')}
                    submitVariant="destructive"
                    hidden={{ operation: 'void-charge', lang: locale }}
                    fields={[
                      {
                        name: 'chargeId',
                        label: _('hospitality_core.folio.field.charge'),
                        type: 'select',
                        required: true,
                        options: activeCharges.map((charge) => ({
                          value: charge.id,
                          label: `${
                            charge.type === 'room' && charge.description.startsWith('room:')
                              ? _('hospitality_core.folio.charge.roomDescription')
                              : charge.description
                          } · ${formatMoney(_, charge.amount)}`,
                        })),
                      },
                      {
                        name: 'reason',
                        label: _('hospitality_core.folio.field.voidReason'),
                        type: 'textarea',
                        required: true,
                        help: _('hospitality_core.folio.field.voidReasonHint'),
                      },
                    ]}
                  />
                }
              />
            ) : null,
            <Section
              title={_('hospitality_core.folio.section.stays')}
              description={_('hospitality_core.folio.section.staysHint')}
              body={
                stays.length
                  ? dataTable(_, {
                      columns: folioStayColumns(_, locale, timezone),
                      rows: stays,
                      id: (stay) => stay.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.stays'),
                      _('hospitality_core.folio.empty.staysHint'),
                    )
              }
            />,
          ])}
        />,
      ])}
    />
  )
}
