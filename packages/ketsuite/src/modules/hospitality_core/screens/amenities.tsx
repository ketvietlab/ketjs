import { ListScreenFrame } from './page-frame.tsx'
import { amenityColumns, type AmenityRow, type Choice, dataTable, emptyState, feedback, type Frame, RecordForm, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const amenitiesScreen = (
  _: Translator,
  rows: AmenityRow[],
  categories: Choice[],
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.amenities.title')}
    frame={frame}
    body={stack([
      feedback(_, state),
      <Section
        title={_('hospitality_core.screen.amenities.create')}
        description={_('hospitality_core.screen.amenities.createHint')}
        body={
          <RecordForm
            action="/admin/hospitality/amenities"
            method="post"
            submit={_('hospitality_core.action.saveAmenity')}
            submitVariant="primary"
            hidden={{ operation: 'save-amenity' }}
            fields={[
              { name: 'code', label: _('hospitality_core.col.code'), required: true },
              { name: 'name', label: _('hospitality_core.col.name'), required: true },
              {
                name: 'scope',
                label: _('hospitality_core.col.scope'),
                type: 'select',
                value: 'property',
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
                options: [{ value: '', label: '—' }, ...choices(categories)],
              },
              { name: 'sequence', label: _('hospitality_core.field.sequence'), type: 'number', value: 10 },
            ]}
          />
        }
      />,
      rows.length
        ? dataTable(_, { columns: amenityColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.amenities.empty'),
            _('hospitality_core.screen.amenities.emptyHint'),
          ),
    ])}
  />
)
