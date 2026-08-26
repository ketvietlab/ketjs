// Product media management for dense ERP records.
//
// The product module supplies storage URLs and native POST endpoints. This kit
// component owns the gallery/table markup so modules can add media without
// recreating responsive upload and thumbnail behaviour.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { button, iconButton } from './actions.tsx'
import { icon } from './icons.ts'

export type ProductMediaVariantView = {
  id: string
  label: string
  detail?: string | null
  href: string
  images: readonly {
    id: string
    src: string
    alt: string
    primary?: boolean
    removeAction?: string | null
  }[]
}

export type ProductMediaManagementOptions = {
  gallery: {
    title: string
    description: string
    sortLabel: string
    hint: string
    panel: JSXChild
  }
  variants: {
    title: string
    description: string
    columns: {
      variant: string
      primary: string
      gallery: string
      actions: string
    }
    rows: readonly ProductMediaVariantView[]
    empty: string
    addLabel: string
    editLabel: string
    removeLabel: string
    displayLabel: string
    rangeLabel: string
    pageLabel: string
    previousLabel: string
    nextLabel: string
    previousHref?: string | null
    nextHref?: string | null
  }
}

const variantImages = (options: ProductMediaManagementOptions['variants']): TemplateResult =>
  options.rows.length ? (
    <div data-ui="table-scroll" data-product-media-table="variants">
      <table data-ui="table">
        <thead>
          <tr>
            <th data-ui="col" data-priority="primary">
              {options.columns.variant}
            </th>
            <th data-ui="col">{options.columns.primary}</th>
            <th data-ui="col">{options.columns.gallery}</th>
            <th data-ui="col" data-align="end">
              {options.columns.actions}
            </th>
          </tr>
        </thead>
        <tbody>
          {each(
            options.rows,
            (row) => row.id,
            (row) => {
              const primary = row.images.find((image) => image.primary) ?? row.images[0]
              return (
                <tr data-ui="row" data-row={row.id}>
                  <td data-ui="cell" data-priority="primary">
                    <strong>{row.label}</strong>
                    {!!row.detail && <small data-product-media-detail="true">{row.detail}</small>}
                  </td>
                  <td data-ui="cell">
                    {primary ? (
                      <img data-product-media-thumbnail="primary" src={primary.src} alt={primary.alt} />
                    ) : (
                      <span data-product-media-empty="true">—</span>
                    )}
                  </td>
                  <td data-ui="cell">
                    <div data-ui="inline" data-product-media-thumbnails="true">
                      {each(
                        row.images,
                        (image) => image.id,
                        (image) => (
                          <img data-product-media-thumbnail="gallery" src={image.src} alt={image.alt} />
                        ),
                      )}
                      {iconButton({
                        label: options.addLabel,
                        icon: 'plus',
                        href: row.href,
                        variant: 'tertiary',
                        size: 'compact',
                      })}
                    </div>
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
                      {primary?.removeAction ? (
                        <form
                          data-ui="record-form"
                          data-layout="actions"
                          method="post"
                          action={primary.removeAction}
                        >
                          {iconButton({
                            label: options.removeLabel,
                            icon: 'trash-2',
                            type: 'submit',
                            variant: 'tertiary',
                            size: 'compact',
                          })}
                        </form>
                      ) : (
                        iconButton({
                          label: options.removeLabel,
                          icon: 'trash-2',
                          variant: 'tertiary',
                          size: 'compact',
                          disabled: true,
                        })
                      )}
                    </div>
                  </td>
                </tr>
              )
            },
          )}
        </tbody>
      </table>
    </div>
  ) : (
    <p data-ui="section-description" data-product-media-empty="true">
      {options.empty}
    </p>
  )

export const productMediaManagement = (options: ProductMediaManagementOptions): TemplateResult => (
  <div data-ui="stack" data-gap="default" data-scope="product-media">
    <section data-ui="section" data-product-media-panel="gallery">
      <header data-ui="section-head">
        <div>
          <h2 data-ui="section-title">{options.gallery.title}</h2>
          <p data-ui="section-description">{options.gallery.description}</p>
        </div>
        <div data-ui="section-actions">
          {button({ label: options.gallery.sortLabel, variant: 'tertiary' })}
        </div>
      </header>
      <div data-ui="section-body">
        {options.gallery.panel}
        <p data-product-media-hint="true">
          {icon('info')}
          <span>{options.gallery.hint}</span>
        </p>
      </div>
    </section>

    <section data-ui="section" data-product-media-panel="variants">
      <header data-ui="section-head">
        <div>
          <h2 data-ui="section-title">{options.variants.title}</h2>
          <p data-ui="section-description">{options.variants.description}</p>
        </div>
      </header>
      <div data-ui="section-body">{variantImages(options.variants)}</div>
      <footer data-ui="inline" data-product-media-pagination="true">
        <label>
          <span>{options.variants.displayLabel}</span>
          <select data-ui="form-control" disabled aria-label={options.variants.displayLabel}>
            <option>25</option>
          </select>
        </label>
        <span>{options.variants.rangeLabel}</span>
        <nav data-ui="action-group" aria-label={options.variants.rangeLabel}>
          {options.variants.previousHref
            ? iconButton({
                label: options.variants.previousLabel,
                icon: 'chevron-left',
                href: options.variants.previousHref,
                variant: 'tertiary',
              })
            : iconButton({
                label: options.variants.previousLabel,
                icon: 'chevron-left',
                variant: 'tertiary',
                disabled: true,
              })}
          {button({
            label: options.variants.pageLabel,
            variant: 'secondary',
            disabled: true,
          })}
          {options.variants.nextHref
            ? iconButton({
                label: options.variants.nextLabel,
                icon: 'chevron-right',
                href: options.variants.nextHref,
                variant: 'tertiary',
              })
            : iconButton({
                label: options.variants.nextLabel,
                icon: 'chevron-right',
                variant: 'tertiary',
                disabled: true,
              })}
        </nav>
      </footer>
    </section>
  </div>
)
