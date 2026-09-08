import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState, LoadingState } from '../../primitives/feedback/index.tsx'
import { PagerBar } from '../../patterns/list-chrome/index.tsx'
import type { PagerBarProps } from '../../patterns/list-chrome/index.tsx'

export const HOOKS = [
  'resource-list',
  'resource-list-item',
  'resource-list-select',
  'resource-list-link',
] as const

export type ResourceListProps<Row> = {
  label: string
  rows: readonly Row[]
  id: (row: Row) => string
  href: (row: Row) => string
  primary: (row: Row) => JSXChild
  secondary?: (row: Row) => JSXChild
  meta?: (row: Row) => JSXChild
  selectedIds?: readonly string[]
  selectionName?: string
  selectionForm?: string
  loading?: boolean
  loadingLabel?: string
  emptyTitle?: string
  emptyMessage?: string
  pager?: PagerBarProps
}

export const ResourceList = <Row,>(props: ResourceListProps<Row>): TemplateResult => {
  if (props.loading) return <LoadingState label={props.loadingLabel ?? 'Loading resources'} />
  if (props.rows.length === 0)
    return (
      <EmptyState
        title={props.emptyTitle ?? 'No resources'}
        message={props.emptyMessage ?? 'No results match this view.'}
      />
    )
  return (
    <div>
      <ul data-ui="resource-list" aria-label={props.label}>
        {each(props.rows, props.id, (row) => {
          const id = props.id(row)
          return (
            <li data-ui="resource-list-item" data-selected={props.selectedIds?.includes(id) ? 'true' : null}>
              {props.selectedIds !== undefined && (
                <input
                  data-ui="resource-list-select"
                  type="checkbox"
                  name={props.selectionName ?? 'ids'}
                  value={id}
                  form={props.selectionForm}
                  checked={props.selectedIds.includes(id)}
                  aria-label={`Select ${id}`}
                />
              )}
              <a data-ui="resource-list-link" href={props.href(row)}>
                <strong>{props.primary(row)}</strong>
                {props.secondary && <span>{props.secondary(row)}</span>}
              </a>
              {props.meta && <span>{props.meta(row)}</span>}
            </li>
          )
        })}
      </ul>
      {props.pager && <PagerBar {...props.pager} />}
    </div>
  )
}
