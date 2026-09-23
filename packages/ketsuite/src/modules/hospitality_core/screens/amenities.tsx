import { prepareCollectionTable } from '../../../ui/index.ts'
import { ListScreenFrame } from './page-frame.tsx'
import {
  amenityColumns,
  type AmenityRow,
  type Choice,
  choices,
  collectionTable,
  emptyState,
  feedback,
  type DataTable,
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
  /** What the route decided about the table, notably the groups it is read by. */
  table?: Partial<DataTable<AmenityRow>>,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    { columns: amenityColumns(_), rows, id: (row) => row.id, ...table },
    { paginate: !table?.groups },
  )
  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.amenities.title')}
      frame={collection.frame}
      headerActions={linkButton({
        label: _('hospitality_core.screen.amenities.create'),
        href: modal?.createHref ?? '/admin/hospitality/amenities?create=1',
        variant: 'primary',
      })}
      body={stack([
        feedback(_, state),
        collection.table.rows.length || table?.groups?.length
          ? collectionTable(_, collection.table)
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
