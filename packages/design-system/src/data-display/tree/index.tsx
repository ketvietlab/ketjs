import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['tree', 'tree-item', 'tree-link', 'tree-grid', 'tree-grid-row'] as const

export type TreeNode = {
  id: string
  label: JSXChild
  href?: string
  active?: boolean
  expanded?: boolean
  children?: readonly TreeNode[]
}

const activeNode = (items: readonly TreeNode[]): TreeNode | undefined => {
  for (const item of items) {
    if (item.active) return item
    if (item.children?.length && item.expanded !== false) {
      const nested = activeNode(item.children)
      if (nested) return nested
    }
  }
  return undefined
}

const nodes = (items: readonly TreeNode[], level: number, tabbableId: string | undefined): TemplateResult => (
  <ul role={level === 1 ? 'tree' : 'group'}>
    {each(
      items,
      (item) => item.id,
      (item) => (
        <li data-ui="tree-item" role="none">
          {item.href ? (
            <a
              data-ui="tree-link"
              href={item.href}
              role="treeitem"
              tabindex={item.id === tabbableId ? '0' : '-1'}
              aria-level={String(level)}
              aria-expanded={item.children?.length ? String(item.expanded !== false) : null}
              aria-current={item.active ? 'page' : null}
            >
              {item.label}
            </a>
          ) : (
            // biome-ignore lint/a11y/useFocusableInteractive: the serialized lowercase tabindex is the explicit focus contract for this treeitem.
            <span
              data-ui="tree-link"
              role="treeitem"
              tabindex={item.id === tabbableId ? '0' : '-1'}
              aria-level={String(level)}
              aria-expanded={item.children?.length ? String(item.expanded !== false) : null}
              aria-current={item.active ? 'page' : null}
            >
              {item.label}
            </span>
          )}
          {item.children?.length && item.expanded !== false
            ? nodes(item.children, level + 1, tabbableId)
            : null}
        </li>
      ),
    )}
  </ul>
)

export const Tree = (props: { label: string; nodes: readonly TreeNode[] }): TemplateResult => (
  <nav data-ui="tree" aria-label={props.label}>
    {nodes(props.nodes, 1, activeNode(props.nodes)?.id ?? props.nodes[0]?.id)}
  </nav>
)

export type TreeGridColumn<Row> = { key: string; label: string; cell: (row: Row) => JSXChild }
export type TreeGridRow<Row> = { row: Row; level: number; expanded?: boolean; hasChildren?: boolean }
export const TreeGrid = <Row,>(props: {
  label: string
  rows: readonly TreeGridRow<Row>[]
  id: (row: Row) => string
  primary: (row: Row) => JSXChild
  columns: readonly TreeGridColumn<Row>[]
}): TemplateResult => (
  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA treegrid intentionally augments the native table model with expandable hierarchical rows.
  <table data-ui="tree-grid" role="treegrid" aria-label={props.label}>
    <thead>
      <tr>
        <th scope="col">Name</th>
        {each(
          props.columns,
          (column) => column.key,
          (column) => (
            <th scope="col">{column.label}</th>
          ),
        )}
      </tr>
    </thead>
    <tbody>
      {each(
        props.rows,
        (item) => props.id(item.row),
        (item) => (
          <tr
            data-ui="tree-grid-row"
            tabindex={
              props.id(item.row) === (props.rows[0] ? props.id(props.rows[0].row) : null) ? '0' : '-1'
            }
            aria-level={String(item.level)}
            aria-expanded={item.hasChildren ? String(item.expanded !== false) : null}
          >
            <th scope="row" style={`--kv-tree-level: ${item.level}`}>
              {props.primary(item.row)}
            </th>
            {each(
              props.columns,
              (column) => column.key,
              (column) => (
                <td>{column.cell(item.row)}</td>
              ),
            )}
          </tr>
        ),
      )}
    </tbody>
  </table>
)
