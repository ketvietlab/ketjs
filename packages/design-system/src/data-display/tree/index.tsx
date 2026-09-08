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

const nodes = (items: readonly TreeNode[], level: number): TemplateResult => (
  <ul role={level === 1 ? 'tree' : 'group'}>
    {each(
      items,
      (item) => item.id,
      (item) => (
        <li
          data-ui="tree-item"
          role="treeitem"
          aria-level={String(level)}
          aria-expanded={item.children?.length ? String(item.expanded !== false) : null}
          aria-current={item.active ? 'page' : null}
        >
          {item.href ? (
            <a data-ui="tree-link" href={item.href}>
              {item.label}
            </a>
          ) : (
            <span data-ui="tree-link">{item.label}</span>
          )}
          {item.children?.length && item.expanded !== false ? nodes(item.children, level + 1) : null}
        </li>
      ),
    )}
  </ul>
)

export const Tree = (props: { label: string; nodes: readonly TreeNode[] }): TemplateResult => (
  <nav data-ui="tree" aria-label={props.label}>
    {nodes(props.nodes, 1)}
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
            role="row"
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
