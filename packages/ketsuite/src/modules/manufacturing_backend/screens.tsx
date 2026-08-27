import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, emptyState, Framed, RecordForm, Section, stack, Surface } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

type R = Record<string, unknown>

export const workCentersScreen = (
  _: Translator,
  frame: Frame,
  rows: R[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('manufacturing_backend.workCenters.title')}
    frame={frame}
    body={stack([
      <Section
        title={_('manufacturing_backend.workCenters.create')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/manufacturing/work-centers"
                fields={[
                  { name: 'code', label: _('manufacturing_backend.field.code'), required: true },
                  { name: 'name', label: _('manufacturing_backend.field.name'), required: true },
                  {
                    name: 'capacity',
                    label: _('manufacturing_backend.field.capacity'),
                    type: 'decimal',
                    value: 1,
                    required: true,
                  },
                  {
                    name: 'timeEfficiency',
                    label: _('manufacturing_backend.field.efficiency'),
                    type: 'decimal',
                    value: 100,
                    required: true,
                  },
                  {
                    name: 'costPerHour',
                    label: _('manufacturing_backend.field.cost'),
                    type: 'decimal',
                    value: 0,
                  },
                ]}
                errors={errors}
                submit={_('manufacturing_backend.action.create')}
                submitVariant="primary"
              />
            }
          />
        }
      />,
      rows.length
        ? dataTable(_, {
            rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'code',
                label: _('manufacturing_backend.field.code'),
                cell: (row) => String(row.code),
                priority: 'primary',
              },
              { key: 'name', label: _('manufacturing_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'capacity',
                label: _('manufacturing_backend.field.capacity'),
                cell: (row) => String(row.capacity),
              },
            ],
          })
        : emptyState(
            _('manufacturing_backend.empty.workCenters'),
            _('manufacturing_backend.empty.workCentersHint'),
          ),
    ])}
  />
)
