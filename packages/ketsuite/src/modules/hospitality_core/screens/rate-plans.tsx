import { ListScreenFrame } from './page-frame.tsx'
import {
  type Choice,
  choices,
  dataTable,
  emptyState,
  feedback,
  type Frame,
  ratePlanColumns,
  type RatePlanRow,
  RecordForm,
  Section,
  setupAction,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const ratePlansScreen = (
  _: Translator,
  rows: RatePlanRow[],
  properties: Choice[],
  roomTypes: Choice[],
  propertyId: string | undefined,
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.ratePlans.title')}
    frame={frame}
    body={stack([
      feedback(_, state),
      <RecordForm
        action="/admin/hospitality/rate-plans"
        method="get"
        layout="inline"
        submit={_('hospitality_core.action.select')}
        submitVariant="secondary"
        fields={[
          {
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            type: 'select',
            value: propertyId,
            options: choices(properties),
            required: true,
          },
        ]}
      />,
      <Section
        title={_('hospitality_core.screen.ratePlans.create')}
        description={_('hospitality_core.screen.ratePlans.createHint')}
        body={
          roomTypes.length ? (
            <RecordForm
              action={`/admin/hospitality/rate-plans${propertyId ? `?property=${encodeURIComponent(propertyId)}` : ''}`}
              method="post"
              submit={_('hospitality_core.action.saveRatePlan')}
              submitVariant="primary"
              hidden={{ operation: 'save-rate-plan', propertyId: propertyId ?? '' }}
              fields={[
                {
                  name: 'roomTypeId',
                  label: _('hospitality_core.col.roomType'),
                  type: 'select',
                  options: choices(roomTypes),
                  required: true,
                },
                { name: 'code', label: _('hospitality_core.col.code'), required: true },
                { name: 'name', label: _('hospitality_core.col.name'), required: true },
                {
                  name: 'rateType',
                  label: _('hospitality_core.col.rateType'),
                  type: 'select',
                  value: 'nightly',
                  options: ['nightly', 'hourly', 'weekly', 'monthly'].map((value) => ({
                    value,
                    label: _(`hospitality_core.bookingType.${value}`),
                  })),
                  required: true,
                },
                { name: 'amount', label: _('hospitality_core.col.amount'), type: 'decimal', required: true },
                {
                  name: 'mealPlan',
                  label: _('hospitality_core.col.mealPlan'),
                  type: 'select',
                  options: [
                    { value: '', label: '—' },
                    ...['RO', 'BB', 'HB', 'FB', 'AI'].map((value) => ({
                      value,
                      label: _(`hospitality_core.mealPlan.${value}`),
                    })),
                  ],
                },
                { name: 'minStay', label: _('hospitality_core.field.minStay'), type: 'number', value: 0 },
                { name: 'maxStay', label: _('hospitality_core.field.maxStay'), type: 'number', value: 0 },
                {
                  name: 'isDefault',
                  label: _('hospitality_core.field.isDefault'),
                  type: 'checkbox',
                  help: _('hospitality_core.field.isDefaultHint'),
                },
                { name: 'active', label: _('hospitality_core.field.active'), type: 'checkbox', value: true },
              ]}
            />
          ) : (
            emptyState(
              _('hospitality_core.screen.ratePlans.noRoomTypes'),
              _('hospitality_core.screen.ratePlans.noRoomTypesHint'),
              {
                actions: setupAction(
                  _('hospitality_core.roomType.action.create'),
                  '/admin/hospitality/room-types/new',
                ),
              },
            )
          )
        }
      />,
      <Section
        title={_('hospitality_core.screen.ratePlans.list')}
        body={
          rows.length
            ? dataTable(_, { columns: ratePlanColumns(_), rows, id: (row) => row.id })
            : emptyState(
                _('hospitality_core.screen.ratePlans.empty'),
                _('hospitality_core.screen.ratePlans.emptyHint'),
              )
        }
      />,
    ])}
  />
)
