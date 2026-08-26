// The dense attribute and variant editor used by product records.
//
// The Product module supplies labels, rows and URLs. This kit component owns the
// table markup so responsive behaviour and action hit areas do not drift into a
// one-off screen implementation.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { button, iconButton, linkButton } from './actions.tsx'
import { icon } from './icons.ts'
import { badge, countBadge, inline } from './primitives.tsx'

export type ProductAttributeLineView = {
  id: string
  name: string
  values: readonly string[]
  editHref: string
  removeAction: string
}

export type ProductVariantRowView = {
  id: string
  code: string
  values: readonly string[]
  sku: string
  price: string
  stock: string
  active: boolean
  stateLabel: string
  href: string
}

export type ProductVariantManagementOptions = {
  attributes: {
    title: string
    description: string
    sortLabel: string
    columns: {
      name: string
      values: string
      actions: string
    }
    lines: readonly ProductAttributeLineView[]
    empty: string
    editLabel: string
    removeLabel: string
    addLabel: string
    addForm: JSXChild
  }
  variants: {
    title: string
    description: string
    generateLabel: string
    generateAction: string
    refreshLabel: string
    columns: {
      code: string
      values: string
      sku: string
      price: string
      stock: string
      state: string
      actions: string
    }
    rows: readonly ProductVariantRowView[]
    empty: string
    editLabel: string
    moreLabel: string
    selectAllLabel: string
    selectRowLabel: string
    displayLabel: string
    rangeLabel: string
    pageLabel: string
    previousLabel: string
    nextLabel: string
    previousHref?: string | null
    nextHref?: string | null
  }
}

const attributeTable = (options: ProductVariantManagementOptions['attributes']): TemplateResult => (
  <>
    {options.lines.length ? (
      <div data-ui="table-scroll" data-product-table="attributes">
        <table data-ui="table">
          <thead>
            <tr>
              <th data-ui="col" data-product-grip="true" aria-label={options.sortLabel} />
              <th data-ui="col" data-priority="primary">
                {options.columns.name}
              </th>
              <th data-ui="col">{options.columns.values}</th>
              <th data-ui="col" data-align="end">
                {options.columns.actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {each(
              options.lines,
              (line) => line.id,
              (line) => (
                <tr data-ui="row" data-row={line.id}>
                  <td data-ui="cell" data-product-grip="true">
                    {icon('grip-vertical')}
                  </td>
                  <td data-ui="cell" data-priority="primary">
                    <strong>{line.name}</strong>
                  </td>
                  <td data-ui="cell" data-product-values="true">
                    {inline([
                      ...line.values.map((value) => badge(value)),
                      countBadge(line.values.length, `${line.name}: ${line.values.length}`),
                    ])}
                  </td>
                  <td data-ui="cell" data-align="end">
                    <div data-ui="action-group" role="group" aria-label={options.columns.actions}>
                      {iconButton({
                        label: options.editLabel,
                        icon: 'pencil',
                        href: line.editHref,
                        variant: 'tertiary',
                        size: 'compact',
                      })}
                      <form
                        data-ui="record-form"
                        data-layout="actions"
                        method="post"
                        action={line.removeAction}
                      >
                        {iconButton({
                          label: options.removeLabel,
                          icon: 'trash-2',
                          type: 'submit',
                          variant: 'tertiary',
                          size: 'compact',
                        })}
                      </form>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    ) : (
      <p data-ui="section-description" data-product-empty="true">
        {options.empty}
      </p>
    )}
    <details data-ui="surface" data-product-attribute-add="true">
      <summary>
        {icon('plus')}
        <span>{options.addLabel}</span>
      </summary>
      <div data-product-attribute-form="true">{options.addForm}</div>
    </details>
  </>
)

const variantTable = (options: ProductVariantManagementOptions['variants']): TemplateResult => (
  <>
    {options.rows.length ? (
      <div data-ui="table-scroll" data-product-table="variants">
        <table data-ui="table">
          <thead>
            <tr>
              <th data-ui="select-col">
                <input
                  data-ui="select-all"
                  type="checkbox"
                  autocomplete="off"
                  aria-label={options.selectAllLabel}
                />
              </th>
              <th data-ui="col" data-priority="primary">
                {options.columns.code}
              </th>
              <th data-ui="col">{options.columns.values}</th>
              <th data-ui="col">{options.columns.sku}</th>
              <th data-ui="col" data-align="end">
                {options.columns.price}
              </th>
              <th data-ui="col" data-align="end">
                {options.columns.stock}
              </th>
              <th data-ui="col">{options.columns.state}</th>
              <th data-ui="col" data-align="end">
                {options.columns.actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {each(
              options.rows,
              (row) => row.id,
              (row) => (
                <tr data-ui="row" data-row={row.id} data-row-href={row.href}>
                  <td data-ui="select-cell">
                    <input
                      data-ui="row-select"
                      type="checkbox"
                      autocomplete="off"
                      aria-label={`${options.selectRowLabel}: ${row.code}`}
                    />
                  </td>
                  <td data-ui="cell" data-priority="primary">
                    <strong>{row.code}</strong>
                  </td>
                  <td data-ui="cell" data-product-values="true">
                    {row.values.length ? inline(row.values.map((value) => badge(value))) : '—'}
                  </td>
                  <td data-ui="cell" data-kind="identifier">
                    {row.sku}
                  </td>
                  <td data-ui="cell" data-kind="currency" data-align="end">
                    {row.price}
                  </td>
                  <td data-ui="cell" data-kind="number" data-align="end">
                    {row.stock}
                  </td>
                  <td data-ui="cell" data-kind="status">
                    {badge(
                      row.stateLabel,
                      row.active ? 'positive' : 'neutral',
                      row.active ? 'active' : 'archived',
                    )}
                  </td>
                  <td data-ui="cell" data-align="end">
                    <div data-ui="action-group" role="group" aria-label={options.columns.actions}>
                      {iconButton({
                        label: options.editLabel,
                        icon: 'pencil',
                        href: row.href,
                        variant: 'tertiary',
                        size: 'compact',
                      })}
                      {iconButton({
                        label: options.moreLabel,
                        icon: 'more-horizontal',
                        variant: 'tertiary',
                        size: 'compact',
                        disabled: true,
                      })}
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    ) : (
      <p data-ui="section-description" data-product-empty="true">
        {options.empty}
      </p>
    )}
    <footer data-ui="inline" data-product-pagination="true">
      <label>
        <span>{options.displayLabel}</span>
        <select data-ui="form-control" disabled aria-label={options.displayLabel}>
          <option>10</option>
        </select>
      </label>
      <span>{options.rangeLabel}</span>
      <nav data-ui="action-group" aria-label={options.rangeLabel}>
        {options.previousHref
          ? iconButton({
              label: options.previousLabel,
              icon: 'chevron-left',
              href: options.previousHref,
              variant: 'tertiary',
            })
          : iconButton({
              label: options.previousLabel,
              icon: 'chevron-left',
              variant: 'tertiary',
              disabled: true,
            })}
        {linkButton({
          label: options.pageLabel,
          href: '#',
          variant: 'secondary',
          disabled: true,
        })}
        {options.nextHref
          ? iconButton({
              label: options.nextLabel,
              icon: 'chevron-right',
              href: options.nextHref,
              variant: 'tertiary',
            })
          : iconButton({
              label: options.nextLabel,
              icon: 'chevron-right',
              variant: 'tertiary',
              disabled: true,
            })}
      </nav>
    </footer>
  </>
)

export const productVariantManagement = (options: ProductVariantManagementOptions): TemplateResult => (
  <div data-ui="stack" data-gap="default" data-scope="product-variants">
    <section data-ui="section" data-product-panel="attributes">
      <header data-ui="section-head">
        <div>
          <h2 data-ui="section-title">{options.attributes.title}</h2>
          <p data-ui="section-description">{options.attributes.description}</p>
        </div>
        <div data-ui="section-actions">
          {button({ label: options.attributes.sortLabel, icon: 'sliders-horizontal', variant: 'tertiary' })}
        </div>
      </header>
      <div data-ui="section-body">{attributeTable(options.attributes)}</div>
    </section>

    <section data-ui="section" data-product-panel="variants">
      <header data-ui="section-head">
        <div>
          <h2 data-ui="section-title">{options.variants.title}</h2>
          <p data-ui="section-description">{options.variants.description}</p>
        </div>
        <div data-ui="section-actions">
          <form
            id="product-variant-generate-form"
            data-ui="record-form"
            data-layout="actions"
            method="post"
            action={options.variants.generateAction}
          >
            {button({
              label: options.variants.generateLabel,
              icon: 'plus',
              type: 'submit',
              variant: 'primary',
            })}
          </form>
          {iconButton({
            label: options.variants.refreshLabel,
            icon: 'refresh-cw',
            type: 'submit',
            form: 'product-variant-generate-form',
            variant: 'tertiary',
          })}
        </div>
      </header>
      <div data-ui="section-body">{variantTable(options.variants)}</div>
    </section>
  </div>
)
