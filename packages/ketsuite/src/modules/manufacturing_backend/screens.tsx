import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type R = Record<string, unknown>

const stateBadge = (value: unknown) => {
  const state = String(value ?? '')
  return badge(
    state,
    state === 'done'
      ? 'positive'
      : state === 'cancelled'
        ? 'danger'
        : state === 'in_progress'
          ? 'warning'
          : 'neutral',
  )
}

export const orderScreen = (
  _: Translator,
  frame: Frame,
  row: R,
  errors: string[] = [],
  action = `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`,
): TemplateResult => {
  const workOrders = (row.workOrders as R[] | undefined) ?? []
  const moves = (row.moves as R[] | undefined) ?? []
  const workAction = (work: R) => {
    const target = new URL(action, 'http://ket.local')
    target.searchParams.set('workOrderId', String(work.id))
    target.searchParams.set('workOrderVersion', String(work.version))
    return `${target.pathname}${target.search}`
  }
  const actions =
    row.state === 'draft'
      ? [
          { value: 'confirm', label: _('manufacturing_backend.action.confirm'), variant: 'primary' as const },
          {
            value: 'cancel',
            label: _('manufacturing_backend.action.cancel'),
            variant: 'destructive' as const,
          },
        ]
      : row.state === 'confirmed'
        ? [
            { value: 'start', label: _('manufacturing_backend.action.start'), variant: 'primary' as const },
            {
              value: 'complete',
              label: _('manufacturing_backend.action.complete'),
              variant: 'primary' as const,
            },
            {
              value: 'cancel',
              label: _('manufacturing_backend.action.cancel'),
              variant: 'destructive' as const,
            },
          ]
        : row.state === 'in_progress'
          ? [
              {
                value: 'complete',
                label: _('manufacturing_backend.action.complete'),
                variant: 'primary' as const,
              },
              {
                value: 'cancel',
                label: _('manufacturing_backend.action.cancel'),
                variant: 'destructive' as const,
              },
            ]
          : []
  return (
    <Framed
      translator={_}
      title={String(row.name)}
      frame={frame}
      body={stack([
        ...(errors.length
          ? [
              <Notice
                tone="danger"
                title={_('manufacturing_backend.error.invalid')}
                message={errors.join(' · ')}
              />,
            ]
          : []),
        <Section
          title={_('manufacturing_backend.orders.detail')}
          description={`${_('manufacturing_backend.field.state')}: ${String(row.state)} · ${_('manufacturing_backend.field.quantity')}: ${String(row.productQty)}`}
          body={
            <Surface
              body={
                actions.length ? <RecordActions action={action} actions={actions} /> : stateBadge(row.state)
              }
            />
          }
        />,
        ...(workOrders.length
          ? [
              <Section
                title={_('manufacturing_backend.field.operation')}
                body={dataTable(_, {
                  rows: workOrders,
                  id: (work) => String(work.id),
                  columns: [
                    {
                      key: 'name',
                      label: _('manufacturing_backend.field.name'),
                      cell: (work) => String(work.name),
                      priority: 'primary',
                    },
                    {
                      key: 'state',
                      label: _('manufacturing_backend.field.state'),
                      cell: (work) => stateBadge(work.state),
                    },
                    {
                      key: 'actions',
                      label: _('manufacturing_backend.field.actions'),
                      cell: (work) => {
                        const workActions =
                          work.state === 'ready' || work.state === 'paused'
                            ? [
                                {
                                  value: 'start-work',
                                  label: _('manufacturing_backend.action.start'),
                                  variant: 'primary' as const,
                                },
                              ]
                            : work.state === 'in_progress'
                              ? [
                                  {
                                    value: 'pause-work',
                                    label: _('manufacturing_backend.action.pause'),
                                    variant: 'secondary' as const,
                                  },
                                  {
                                    value: 'finish-work',
                                    label: _('manufacturing_backend.action.finish'),
                                    variant: 'primary' as const,
                                  },
                                ]
                              : []
                        return workActions.length ? (
                          <RecordActions action={workAction(work)} actions={workActions} />
                        ) : (
                          ''
                        )
                      },
                    },
                  ],
                })}
              />,
            ]
          : []),
        ...(moves.length
          ? [
              <Section
                title={_('manufacturing_backend.field.component')}
                body={dataTable(_, {
                  rows: moves,
                  id: (move) => String(move.id),
                  columns: [
                    {
                      key: 'kind',
                      label: _('manufacturing_backend.field.state'),
                      cell: (move) => String(move.kind),
                    },
                    {
                      key: 'quantity',
                      label: _('manufacturing_backend.field.quantity'),
                      cell: (move) => String((move.move as R | undefined)?.productUomQty ?? ''),
                    },
                  ],
                })}
              />,
            ]
          : []),
      ])}
    />
  )
}

export const bomsScreen = (
  _: Translator,
  frame: Frame,
  rows: R[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('manufacturing_backend.boms.title')}
    frame={frame}
    body={stack([
      <Section
        title={_('manufacturing_backend.boms.create')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/manufacturing/boms"
                fields={fields}
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
                cell: (row) => String(row.code ?? row.id),
                priority: 'primary',
              },
              {
                key: 'product',
                label: _('manufacturing_backend.field.product'),
                cell: (row) => String(row.productId),
              },
              {
                key: 'quantity',
                label: _('manufacturing_backend.field.quantity'),
                cell: (row) => String(row.productQty),
              },
            ],
          })
        : emptyState(_('manufacturing_backend.empty.boms'), _('manufacturing_backend.empty.bomsHint')),
    ])}
  />
)

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
