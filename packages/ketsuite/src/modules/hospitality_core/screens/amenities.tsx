import { ListScreenFrame } from './page-frame.tsx'
import {
  amenityColumns,
  type AmenityRow,
  type Choice,
  choices,
  dataTable,
  emptyState,
  feedback,
  type Frame,
  linkButton,
  modalForm,
  modalWorkspace,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const amenitiesScreen = (
  _: Translator,
  rows: AmenityRow[],
  categories: Choice[],
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
      title={_('hospitality_core.screen.amenities.title')}
      frame={frame}
      actions={linkButton({
        label: _('hospitality_core.screen.amenities.create'),
        href: modal?.createHref ?? '/admin/hospitality/amenities?create=1',
        variant: 'primary',
      })}
      body={stack([
        feedback(_, state),
        rows.length
          ? dataTable(_, { columns: amenityColumns(_), rows, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.screen.amenities.empty'),
              _('hospitality_core.screen.amenities.emptyHint'),
            ),
      ])}
    />
  )
  if (!modal?.open) return list
  return modalWorkspace(
    list,
    modalForm({
      id: 'hospitality-amenity-create',
      title: _('hospitality_core.screen.amenities.create'),
      description: _('hospitality_core.screen.amenities.createHint'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      form: {
        id: 'hospitality-amenity-create-form',
        scope: 'hospitality-amenity-create',
        action: modal.action,
        submit: _('hospitality_core.action.saveAmenity'),
        submitVariant: 'primary',
        errors: modal.errors,
        cancelHref: modal.closeHref,
        cancelLabel: _('hospitality_core.action.cancel'),
        hidden: { operation: 'save-amenity' },
        fields: [
          { name: 'code', label: _('hospitality_core.col.code'), value: modal.values?.code, required: true },
          { name: 'name', label: _('hospitality_core.col.name'), value: modal.values?.name, required: true },
          {
            name: 'scope',
            label: _('hospitality_core.col.scope'),
            type: 'select',
            value: modal.values?.scope ?? 'property',
            options: ['property', 'room'].map((value) => ({
              value,
              label: _(`hospitality_core.amenityScope.${value}`),
            })),
            required: true,
          },
          {
            name: 'categoryId',
            label: _('hospitality_core.col.category'),
            type: 'select',
            value: modal.values?.categoryId,
            options: [{ value: '', label: '—' }, ...choices(categories)],
          },
          {
            name: 'sequence',
            label: _('hospitality_core.field.sequence'),
            type: 'number',
            value: modal.values?.sequence ?? 10,
          },
        ],
      },
    }),
  )
}
