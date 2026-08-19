// The list itself: columns as data, and the small pieces that go in a cell.
//
// A module says what its columns ARE — key, label, how to read one out of a row,
// whether it is on by default. It does not write a <table>. That buys three things
// at once: every list in the product has the same row height, the same header and
// the same overflow behaviour; a column can be turned off without touching markup;
// and a module extending another module's list has something to name.
//
// Which optional columns are on lives in the URL, like everything else about a
// list (D43). The column menu is a list of links, not a form with a submit — a
// checkbox would need a handler, and a handler is client state.

import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import { icon } from './icons.ts'

export type Cell = TemplateResult | string

export type Column<R> = {
  key: string
  label: string
  /** How to read this column out of a row. */
  cell: (row: R) => Cell
  /** Numbers go right, and get tabular figures, so a column can be read down. */
  align?: 'end'
  /**
   * Off unless the URL asks for it. Use this for the columns a specialist wants
   * and everybody else finds noise — an id, an internal reference, a timestamp.
   */
  optional?: boolean
}

export type DataTable<R> = {
  columns: ReadonlyArray<Column<R>>
  rows: readonly R[]
  /** Stable identity, so a re-render moves rows rather than rebuilding them. */
  id: (row: R) => string
  /** Which optional columns are on. From the URL; absent means none of them. */
  shown?: readonly string[]
  /**
   * Where a column menu entry points, given the set it would produce. Absent
   * means no menu — a table with no optional columns has nothing to configure.
   */
  colsHref?: (keys: readonly string[]) => string
}

/** What is actually drawn: every required column, plus the optional ones asked for. */
export const visibleColumns = <R,>(t: DataTable<R>): ReadonlyArray<Column<R>> =>
  t.columns.filter(c => !c.optional || (t.shown ?? []).includes(c.key))

const menu = <R,>(_: Translator, t: DataTable<R>): TemplateResult => {
  const optional = t.columns.filter(c => c.optional)
  const on = new Set(t.shown ?? [])
  return html`
  <details data-ui="col-config">
    <summary data-ui="col-config-open" aria-label=${_('backend.table.columns')}>${icon('sliders-horizontal')}</summary>
    <div data-ui="col-config-menu">
      ${each(optional, c => c.key, c => html`
        <a data-ui="col-toggle" data-on=${String(on.has(c.key))}
           href=${t.colsHref!(on.has(c.key) ? [...on].filter(k => k !== c.key) : [...on, c.key])}>
          <span data-ui="col-toggle-mark">${on.has(c.key) ? '✓' : ''}</span>${c.label}
        </a>`)}
    </div>
  </details>`
}

/**
 * One table, drawn the same way everywhere.
 *
 * The header is sticky and the whole thing scrolls inside its own box: a wide list
 * must not make the page scroll sideways, because then the sidebar leaves too.
 */
export const dataTable = <R,>(_: Translator, t: DataTable<R>): TemplateResult => {
  const cols = visibleColumns(t)
  const configurable = !!t.colsHref && t.columns.some(c => c.optional)
  return html`
<div data-ui="table-scroll">
  <table data-ui="table">
    <thead>
      <tr>
        ${each(cols, c => c.key, c => html`
          <th data-ui="col" data-col=${c.key} data-align=${c.align ?? 'start'}>${c.label}</th>`)}
        ${when(configurable, () => html`<th data-ui="col-actions">${menu(_, t)}</th>`)}
      </tr>
    </thead>
    <tbody>
      ${each(t.rows, t.id, row => html`
        <tr data-ui="row" data-row=${t.id(row)}>
          ${each(cols, c => c.key, c => html`
            <td data-ui="cell" data-col=${c.key} data-align=${c.align ?? 'start'}>${c.cell(row)}</td>`)}
          ${when(configurable, () => html`<td data-ui="cell-actions"></td>`)}
        </tr>`)}
    </tbody>
  </table>
</div>`
}

/**
 * A status, as a word with a colour behind it.
 *
 * The tone is named for what it means, not for what it looks like: a design team
 * that wants "draft" to be amber changes one token, and every draft in the product
 * follows. `data-value` carries the raw state as well, so a stylesheet can be more
 * specific when it has to be.
 */
export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export const badge = (label: string, tone: Tone = 'neutral', value?: string): TemplateResult => html`
  <span data-ui="badge" data-tone=${tone} data-value=${value ?? ''}>${label}</span>`

/**
 * Initials in a circle.
 *
 * Not a photograph: nothing in the product stores one yet, and a broken image in
 * every row of a list is worse than no image at all. When avatars do arrive this
 * stays as the fallback, which is what it would have had to be anyway.
 */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  // Vietnamese names put the given name last, and that is the one people answer to.
  const first = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!
  const second = parts.length > 2 ? parts[parts.length - 2]! : ''
  return (second.slice(0, 1) + first.slice(0, 1)).toLocaleUpperCase('vi')
}

export const avatar = (name: string): TemplateResult => html`
  <span data-ui="avatar" title=${name} aria-hidden="true">${initials(name)}</span>`

/** A name with its avatar — the shape a person's column takes in every list. */
export const person = (name: string): TemplateResult => html`
  <span data-ui="person">${avatar(name)}<span data-ui="person-name">${name}</span></span>`
