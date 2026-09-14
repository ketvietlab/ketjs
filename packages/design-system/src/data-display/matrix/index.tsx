import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'data-matrix',
  'data-matrix-head',
  'data-matrix-heading',
  'data-matrix-eyebrow',
  'data-matrix-title',
  'data-matrix-description',
  'data-matrix-summary',
  'data-matrix-scroll',
  'data-matrix-table',
  'data-matrix-column',
  'data-matrix-row-head',
  'data-matrix-row-leading',
  'data-matrix-row-title',
  'data-matrix-row-description',
  'data-matrix-row-status',
  'data-matrix-row-actions',
  'data-matrix-cell',
] as const

export type DataMatrixColumn = {
  id: string
  label: string
  description?: string | null
}

export type DataMatrixRow = {
  id: string
  label: string
  description?: string | null
  leading?: JSXChild
  status?: JSXChild
  actions?: JSXChild
  cells: Readonly<Record<string, JSXChild>>
}

export type DataMatrixProps = {
  label: string
  /** Localised heading for the row identity column, for example “Checkpoint”. */
  rowLabel: string
  columns: readonly DataMatrixColumn[]
  rows: readonly DataMatrixRow[]
  eyebrow?: string | null
  title?: string | null
  description?: string | null
  summary?: JSXChild
  /** Controls only the scrollable table's readable floor, never the viewport. */
  width?: 'default' | 'wide'
}

/**
 * Compare the same dimensions across ordered records or checkpoints.
 * Applications own cell content and workflow actions; the matrix owns table
 * semantics, sticky row identity, horizontal containment and responsive chrome.
 */
export const DataMatrix = (props: DataMatrixProps): TemplateResult => (
  <section data-ui="data-matrix" aria-label={props.label} data-width={props.width ?? 'default'}>
    {(props.title || props.description || props.summary !== undefined) && (
      <header data-ui="data-matrix-head">
        <div data-ui="data-matrix-heading">
          {!!props.eyebrow && <span data-ui="data-matrix-eyebrow">{props.eyebrow}</span>}
          {!!props.title && <h2 data-ui="data-matrix-title">{props.title}</h2>}
          {!!props.description && <p data-ui="data-matrix-description">{props.description}</p>}
        </div>
        {props.summary !== undefined && <div data-ui="data-matrix-summary">{props.summary}</div>}
      </header>
    )}
    {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be reachable by keyboard (WCAG 2.1.1). */}
    <div data-ui="data-matrix-scroll" role="region" tabIndex="0" aria-label={props.label}>
      <table data-ui="data-matrix-table">
        <thead>
          <tr>
            <th scope="col" data-ui="data-matrix-row-head">
              {props.rowLabel}
            </th>
            {each(
              props.columns,
              (column) => column.id,
              (column) => (
                <th scope="col" data-ui="data-matrix-column">
                  <strong>{column.label}</strong>
                  {!!column.description && <small>{column.description}</small>}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {each(
            props.rows,
            (row) => row.id,
            (row) => (
              <tr>
                <th scope="row" data-ui="data-matrix-row-head">
                  <div data-ui="data-matrix-row-title">
                    {row.leading !== undefined && (
                      <span data-ui="data-matrix-row-leading">{row.leading}</span>
                    )}
                    <strong>{row.label}</strong>
                    {row.status !== undefined && <span data-ui="data-matrix-row-status">{row.status}</span>}
                  </div>
                  {!!row.description && (
                    <small data-ui="data-matrix-row-description">{row.description}</small>
                  )}
                  {row.actions !== undefined && <div data-ui="data-matrix-row-actions">{row.actions}</div>}
                </th>
                {each(
                  props.columns,
                  (column) => column.id,
                  (column) => (
                    <td data-ui="data-matrix-cell">{row.cells[column.id]}</td>
                  ),
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  </section>
)
