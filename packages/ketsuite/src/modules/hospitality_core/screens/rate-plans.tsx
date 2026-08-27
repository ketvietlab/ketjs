import { ListScreenFrame } from './page-frame.tsx'
import {
  type Choice,
  choices,
  dataTable,
  emptyState,
  feedback,
  type Frame,
  linkButton,
  modalForm,
  modalWorkspace,
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
  modal?: {
    open: boolean
    createHref: string
    closeHref: string
    action: string
    errors?: readonly string[]
    values?: Record<string, string>
  },
): TemplateResult => {
  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.ratePlans.title')}
      frame={frame}
      actions={
        roomTypes.length
          ? linkButton({
              label: _('hospitality_core.screen.ratePlans.create'),
              href: modal?.createHref ?? '/admin/hospitality/rate-plans?create=1',
              variant: 'primary',
            })
          : undefined
      }
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
      roomTypes.length
        ? null
        : emptyState(
            _('hospitality_core.screen.ratePlans.noRoomTypes'),
            _('hospitality_core.screen.ratePlans.noRoomTypesHint'),
            {
              actions: setupAction(
                _('hospitality_core.roomType.action.create'),
                '/admin/hospitality/room-types/new',
              ),
            },
          ),
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
  if (!modal?.open || !roomTypes.length) return list
  return modalWorkspace(
    list,
    modalForm({
      id: 'hospitality-rate-plan-create',
      title: _('hospitality_core.screen.ratePlans.create'),
      description: _('hospitality_core.screen.ratePlans.createHint'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      size: 'large',
      form: {
        id: 'hospitality-rate-plan-create-form',
        scope: 'hospitality-rate-plan-create',
        action: modal.action,
        submit: _('hospitality_core.action.saveRatePlan'),
        submitVariant: 'primary',
        errors: modal.errors,
        cancelHref: modal.closeHref,
        cancelLabel: _('hospitality_core.action.cancel'),
        hidden: { operation: 'save-rate-plan', propertyId: propertyId ?? '' },
        fields: [
          {
            name: 'roomTypeId',
            label: _('hospitality_core.col.roomType'),
            type: 'select',
            value: modal.values?.roomTypeId,
            options: choices(roomTypes),
            required: true,
          },
          { name: 'code', label: _('hospitality_core.col.code'), value: modal.values?.code, required: true },
          { name: 'name', label: _('hospitality_core.col.name'), value: modal.values?.name, required: true },
          {
            name: 'rateType',
            label: _('hospitality_core.col.rateType'),
            type: 'select',
            value: modal.values?.rateType ?? 'nightly',
            options: ['nightly', 'hourly', 'weekly', 'monthly'].map((value) => ({
              value,
              label: _(`hospitality_core.bookingType.${value}`),
            })),
            required: true,
          },
          {
            name: 'amount',
            label: _('hospitality_core.col.amount'),
            type: 'decimal',
            value: modal.values?.amount,
            required: true,
          },
          {
            name: 'mealPlan',
            label: _('hospitality_core.col.mealPlan'),
            type: 'select',
            value: modal.values?.mealPlan,
            options: [
              { value: '', label: '—' },
              ...['RO', 'BB', 'HB', 'FB', 'AI'].map((value) => ({
                value,
                label: _(`hospitality_core.mealPlan.${value}`),
              })),
            ],
          },
          {
            name: 'minStay',
            label: _('hospitality_core.field.minStay'),
            type: 'number',
            value: modal.values?.minStay ?? 0,
          },
          {
            name: 'maxStay',
            label: _('hospitality_core.field.maxStay'),
            type: 'number',
            value: modal.values?.maxStay ?? 0,
          },
          {
            name: 'isDefault',
            label: _('hospitality_core.field.isDefault'),
            type: 'checkbox',
            value: modal.values?.isDefault === '1',
            help: _('hospitality_core.field.isDefaultHint'),
          },
          {
            name: 'active',
            label: _('hospitality_core.field.active'),
            type: 'checkbox',
            value: modal.values?.active === undefined || modal.values.active === '1',
          },
        ],
      },
    }),
  )
}
