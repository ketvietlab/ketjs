import {
  CardGrid,
  type Choice,
  choices,
  dataTable,
  emptyState,
  extraLineColumns,
  type ExtraLineRow,
  feedback,
  formatMoney,
  FormCluster,
  type Frame,
  Framed,
  Metric,
  propertyChargeColumns,
  type PropertyChargeRow,
  RecordForm,
  Section,
  serviceChargeColumns,
  type ServiceChargeRow,
  type ServiceProductRow,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const servicesScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    products: ServiceProductRow[]
    targets: Array<Choice & { type: 'reservation' | 'stay' }>
    propertyCharges: PropertyChargeRow[]
    extraLines: ExtraLineRow[]
    charges: ServiceChargeRow[]
    ids: { propertyCharge: string; extraLine: string; requestKey: string }
  },
  locale: string,
  timezone: string,
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  const serviceQuery = new URLSearchParams({ lang: locale })
  if (data.propertyId) serviceQuery.set('property', data.propertyId)
  const baseQuery = `?${serviceQuery.toString()}`
  const activeCharges = data.charges.filter((row) => row.state === 'active')
  const totalPosted = activeCharges.reduce((sum, row) => sum + Number(row.amount), 0)
  const targetOptions = data.targets.map((row) => ({
    value: `${row.type}:${row.id}`,
    label: `${row.type === 'reservation' ? _('hospitality_core.services.target.reservation') : _('hospitality_core.services.target.stay')} · ${row.code ? `${row.code} · ` : ''}${row.name}`,
  }))
  const productOptions = data.products.map((row) => ({
    value: row.id,
    label: `${row.code ? `${row.code} · ` : ''}${row.name} · ${formatMoney(_, row.unitPrice)}`,
  }))
  const extraOptions = data.extraLines
    .filter((row) => row.active)
    .map((row) => ({
      value: row.id,
      label: `${row.description} · ${_(`hospitality_core.extraRecurrence.${row.recurrence}`)}`,
    }))

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.services.title')}
      frame={frame}
      body={stack([
        feedback(_, state),
        <RecordForm
          action="/admin/hospitality/services"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
              required: true,
            },
          ]}
        />,
        <CardGrid
          items={[
            {
              id: 'fees',
              label: _('hospitality_core.services.metric.fees'),
              value: data.propertyCharges.length,
            },
            {
              id: 'extras',
              label: _('hospitality_core.services.metric.extras'),
              value: data.extraLines.length,
            },
            {
              id: 'posted',
              label: _('hospitality_core.services.metric.posted'),
              value: activeCharges.length,
            },
            {
              id: 'value',
              label: _('hospitality_core.services.metric.postedValue'),
              value: formatMoney(_, totalPosted),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        <Section
          title={_('hospitality_core.services.section.fees')}
          description={_('hospitality_core.services.section.feesHint')}
          body={
            <FormCluster
              label={_('hospitality_core.services.form.fee')}
              forms={[
                <RecordForm
                  action={`/admin/hospitality/services${baseQuery}`}
                  submit={_('hospitality_core.services.action.saveFee')}
                  submitVariant="secondary"
                  hidden={{
                    operation: 'save-property-charge',
                    id: data.ids.propertyCharge,
                    propertyId: data.propertyId ?? '',
                  }}
                  fields={[
                    {
                      name: 'chargeType',
                      label: _('hospitality_core.col.type'),
                      type: 'select',
                      options: ['parking', 'city_tax', 'internet', 'resort_fee', 'other'].map((value) => ({
                        value,
                        label: _(`hospitality_core.propertyCharge.${value}`),
                      })),
                      required: true,
                    },
                    { name: 'name', label: _('hospitality_core.col.name'), required: true },
                    {
                      name: 'amount',
                      label: _('hospitality_core.col.amount'),
                      type: 'decimal',
                      required: true,
                    },
                    {
                      name: 'description',
                      label: _('hospitality_core.services.field.description'),
                      type: 'textarea',
                      span: 'full',
                    },
                    {
                      name: 'active',
                      label: _('hospitality_core.field.active'),
                      type: 'checkbox',
                      value: true,
                    },
                  ]}
                />,
              ]}
            />
          }
        />,
        data.propertyCharges.length
          ? dataTable(_, {
              columns: propertyChargeColumns(_),
              rows: data.propertyCharges,
              id: (row) => row.id,
            })
          : emptyState(
              _('hospitality_core.services.empty.fees'),
              _('hospitality_core.services.empty.feesHint'),
            ),
        <Section
          title={_('hospitality_core.services.section.intentions')}
          description={_('hospitality_core.services.section.intentionsHint')}
          body={
            data.targets.length && data.products.length ? (
              <FormCluster
                label={_('hospitality_core.services.form.intention')}
                forms={[
                  <RecordForm
                    action={`/admin/hospitality/services${baseQuery}`}
                    submit={_('hospitality_core.services.action.addIntention')}
                    submitVariant="primary"
                    hidden={{
                      operation: 'save-extra-line',
                      id: data.ids.extraLine,
                    }}
                    fields={[
                      {
                        name: 'target',
                        label: _('hospitality_core.services.field.target'),
                        type: 'select',
                        options: targetOptions,
                        required: true,
                      },
                      {
                        name: 'productId',
                        label: _('hospitality_core.services.field.product'),
                        type: 'select',
                        options: productOptions,
                        required: true,
                      },
                      {
                        name: 'description',
                        label: _('hospitality_core.services.field.description'),
                        placeholder: _('hospitality_core.services.field.descriptionHint'),
                      },
                      {
                        name: 'quantity',
                        label: _('hospitality_core.col.quantity'),
                        type: 'decimal',
                        value: 1,
                        required: true,
                      },
                      {
                        name: 'unitPrice',
                        label: _('hospitality_core.services.col.unitPrice'),
                        type: 'decimal',
                        help: _('hospitality_core.services.field.unitPriceHint'),
                      },
                      {
                        name: 'recurrence',
                        label: _('hospitality_core.services.col.recurrence'),
                        type: 'select',
                        options: ['once', 'per_night', 'per_unit'].map((value) => ({
                          value,
                          label: _(`hospitality_core.extraRecurrence.${value}`),
                        })),
                        required: true,
                      },
                      {
                        name: 'active',
                        label: _('hospitality_core.field.active'),
                        type: 'checkbox',
                        value: true,
                      },
                    ]}
                  />,
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.services.empty.catalogue'),
                _('hospitality_core.services.empty.catalogueHint'),
              )
            )
          }
        />,
        data.extraLines.length
          ? dataTable(_, { columns: extraLineColumns(_), rows: data.extraLines, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.services.empty.intentions'),
              _('hospitality_core.services.empty.intentionsHint'),
            ),
        <Section
          title={_('hospitality_core.services.section.post')}
          description={_('hospitality_core.services.section.postHint')}
          body={
            extraOptions.length ? (
              <RecordForm
                action={`/admin/hospitality/services${baseQuery}`}
                submit={_('hospitality_core.services.action.post')}
                submitVariant="primary"
                hidden={{ operation: 'materialize-extra', requestKey: data.ids.requestKey }}
                fields={[
                  {
                    name: 'id',
                    label: _('hospitality_core.services.field.intention'),
                    type: 'select',
                    options: extraOptions,
                    required: true,
                  },
                  {
                    name: 'serviceDate',
                    label: _('hospitality_core.services.field.serviceDate'),
                    type: 'date',
                    help: _('hospitality_core.services.field.serviceDateHint'),
                  },
                  {
                    name: 'quantity',
                    label: _('hospitality_core.col.quantity'),
                    type: 'decimal',
                    help: _('hospitality_core.services.field.postQuantityHint'),
                  },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.services.empty.post'),
                _('hospitality_core.services.empty.postHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.services.section.ledger')}
          description={_('hospitality_core.services.section.ledgerHint')}
          body={
            data.charges.length
              ? dataTable(_, {
                  columns: serviceChargeColumns(_, locale, timezone),
                  rows: data.charges,
                  id: (row) => row.id,
                })
              : emptyState(
                  _('hospitality_core.services.empty.ledger'),
                  _('hospitality_core.services.empty.ledgerHint'),
                )
          }
        />,
      ])}
    />
  )
}
