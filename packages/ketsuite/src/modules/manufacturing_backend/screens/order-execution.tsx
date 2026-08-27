import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  FormCluster,
  FormPage,
  Notice,
  RecordActions,
  Section,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export type ManufacturingOrderExecutionRow = Record<string, unknown>

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
    state,
  )
}

const orderActions = (_: Translator, state: unknown) =>
  state === 'draft'
    ? [
        { value: 'confirm', label: _('manufacturing_backend.action.confirm'), variant: 'primary' as const },
        {
          value: 'cancel',
          label: _('manufacturing_backend.action.cancel'),
          variant: 'destructive' as const,
        },
      ]
    : state === 'confirmed'
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
      : state === 'in_progress'
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

const workActions = (_: Translator, state: unknown) =>
  state === 'ready' || state === 'paused'
    ? [
        {
          value: 'start-work',
          label: _('manufacturing_backend.action.start'),
          variant: 'primary' as const,
        },
      ]
    : state === 'in_progress'
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

/** FormPage shell with specialized execution tables for work orders and stock moves. */
export const orderScreen = (
  _: Translator,
  frame: Frame,
  row: ManufacturingOrderExecutionRow,
  errors: string[] = [],
  action = `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`,
): TemplateResult => {
  const workOrders = (row.workOrders as ManufacturingOrderExecutionRow[] | undefined) ?? []
  const moves = (row.moves as ManufacturingOrderExecutionRow[] | undefined) ?? []
  const actions = orderActions(_, row.state)
  const workAction = (work: ManufacturingOrderExecutionRow) => {
    const target = new URL(action, 'http://ket.local')
    target.searchParams.set('workOrderId', String(work.id))
    target.searchParams.set('workOrderVersion', String(work.version))
    return `${target.pathname}${target.search}`
  }
  const page = (
    <FormPage
      scope="manufacturing-order-execution-form-page"
      title={String(row.name)}
      description={_('manufacturing_backend.orders.detail')}
      status={stateBadge(row.state)}
      meta={badge(`${_('manufacturing_backend.field.quantity')}: ${String(row.productQty)}`, 'neutral')}
      actions={
        actions.length ? (
          <FormCluster
            label={_('manufacturing_backend.orders.detail')}
            forms={[<RecordActions action={action} actions={actions} />]}
          />
        ) : undefined
      }
      body={stack([
        errors.length ? (
          <Notice
            tone="danger"
            title={_('manufacturing_backend.error.invalid')}
            message={errors.join(' · ')}
          />
        ) : null,
        workOrders.length ? (
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
                    const actions = workActions(_, work.state)
                    return actions.length ? <RecordActions action={workAction(work)} actions={actions} /> : ''
                  },
                },
              ],
            })}
          />
        ) : null,
        moves.length ? (
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
                  cell: (move) =>
                    String((move.move as ManufacturingOrderExecutionRow | undefined)?.productUomQty ?? ''),
                },
              ],
            })}
          />
        ) : null,
      ])}
    />
  )

  return shell(_, String(row.name), page, { ...frame, topbar: false, titled: false })
}
