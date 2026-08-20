import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  framed,
  linkButton,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'

export type PricelistRow = { id: string; name: string; currency: string; state: string; sequence: string }

const selectionLabel = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value)
  const key = `pricing_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}
const localized = (path: string, locale: string): string => `${path}${locale}`

export const pricelistsScreen = (
  _: Translator,
  rows: PricelistRow[],
  frame: Frame,
  locale = '',
): TemplateResult => {
  const columns: Array<Column<PricelistRow>> = [
    {
      key: 'name',
      label: _('pricing_backend.col.name'),
      cell: (row) =>
        linkButton({
          label: row.name,
          href: localized(`/admin/pricelists/${row.id}`, locale),
          variant: 'tertiary',
        }),
      priority: 'primary',
    },
    { key: 'currency', label: _('pricing_backend.col.currency'), cell: (row) => row.currency },
    {
      key: 'state',
      label: _('pricing_backend.col.state'),
      cell: (row) => badge(selectionLabel(_, 'state', row.state), 'neutral', row.state),
    },
    { key: 'sequence', label: _('pricing_backend.col.sequence'), cell: (row) => row.sequence },
    { key: 'id', label: _('backend.table.id'), cell: (row) => code(row.id), optional: true },
  ]
  return framed(
    _,
    _('pricing_backend.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: localized('/admin/pricelists', locale),
          submit: _('pricing_backend.action.create'),
          submitVariant: 'primary',
          fields: [
            { name: 'name', label: _('pricing_backend.col.name'), required: true },
            { name: 'sequence', label: _('pricing_backend.col.sequence'), type: 'number', value: 16 },
          ],
        }),
      }),
      rows.length
        ? dataTable(_, { columns, rows, id: (row) => row.id })
        : emptyState(_('pricing_backend.empty'), _('pricing_backend.emptyHint')),
    ]),
  )
}

export const pricelistDetailScreen = (
  _: Translator,
  row: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    String(row.name),
    frame,
    stack([
      section({
        title: _('pricing_backend.detail.settings'),
        body: surface({
          body: recordForm({
            action: localized(`/admin/pricelists/${String(row.id)}`, locale),
            submit: _('pricing_backend.action.save'),
            submitVariant: 'primary',
            hidden: { action: 'save-pricelist' },
            fields: [
              { name: 'name', label: _('pricing_backend.col.name'), value: String(row.name), required: true },
              {
                name: 'sequence',
                label: _('pricing_backend.col.sequence'),
                type: 'number',
                value: Number(row.sequence),
              },
              {
                name: 'currency',
                label: _('pricing_backend.col.currency'),
                value: String(row.currency),
                disabled: true,
              },
              {
                name: 'active',
                label: _('pricing_backend.col.active'),
                type: 'checkbox',
                value: row.active === true,
              },
            ],
          }),
        }),
      }),
      section({
        title: _('pricing_backend.items.title'),
        body:
          items.length === 0
            ? emptyState(_('pricing_backend.items.empty'), _('pricing_backend.items.hint'))
            : dataTable(_, {
                rows: items,
                id: (item) => String(item.id),
                columns: [
                  {
                    key: 'appliedOn',
                    label: _('pricing_backend.field.appliedOn'),
                    cell: (item) => selectionLabel(_, 'appliedOn', item.appliedOn),
                  },
                  {
                    key: 'compute',
                    label: _('pricing_backend.field.computePrice'),
                    cell: (item) => {
                      const value = String(item.computePrice)
                      return badge(selectionLabel(_, 'compute', value), 'neutral', value)
                    },
                  },
                  {
                    key: 'quantity',
                    label: _('pricing_backend.field.minQuantity'),
                    cell: (item) => String(item.minQuantity),
                  },
                  {
                    key: 'base',
                    label: _('pricing_backend.field.base'),
                    cell: (item) => selectionLabel(_, 'base', item.base),
                  },
                ],
              }),
      }),
      section({
        title: _('pricing_backend.items.add'),
        description: _('pricing_backend.items.formulaHint'),
        body: surface({
          body: recordForm({
            action: localized(`/admin/pricelists/${String(row.id)}`, locale),
            submit: _('pricing_backend.action.add'),
            submitVariant: 'secondary',
            hidden: { action: 'add-item' },
            fields: [
              {
                name: 'appliedOn',
                label: _('pricing_backend.field.appliedOn'),
                type: 'select',
                options: ['3_global', '2_product_category', '1_product', '0_product_variant'].map(
                  (value) => ({
                    value,
                    label: selectionLabel(_, 'appliedOn', value),
                  }),
                ),
              },
              { name: 'categoryId', label: _('pricing_backend.field.categoryId') },
              { name: 'templateId', label: _('pricing_backend.field.templateId') },
              { name: 'productId', label: _('pricing_backend.field.productId') },
              {
                name: 'minQuantity',
                label: _('pricing_backend.field.minQuantity'),
                type: 'decimal',
                value: 0,
              },
              { name: 'dateStart', label: _('pricing_backend.field.dateStart'), type: 'datetime-local' },
              { name: 'dateEnd', label: _('pricing_backend.field.dateEnd'), type: 'datetime-local' },
              {
                name: 'base',
                label: _('pricing_backend.field.base'),
                type: 'select',
                options: ['list_price', 'standard_price', 'pricelist'].map((value) => ({
                  value,
                  label: selectionLabel(_, 'base', value),
                })),
              },
              { name: 'basePricelistId', label: _('pricing_backend.field.basePricelistId') },
              {
                name: 'computePrice',
                label: _('pricing_backend.field.computePrice'),
                type: 'select',
                options: ['fixed', 'percentage', 'formula'].map((value) => ({
                  value,
                  label: selectionLabel(_, 'compute', value),
                })),
              },
              { name: 'fixedPrice', label: _('pricing_backend.field.fixedPrice'), type: 'decimal', value: 0 },
              {
                name: 'percentPrice',
                label: _('pricing_backend.field.percentPrice'),
                type: 'decimal',
                value: 0,
              },
              {
                name: 'priceDiscount',
                label: _('pricing_backend.field.priceDiscount'),
                type: 'decimal',
                value: 0,
              },
              { name: 'priceRound', label: _('pricing_backend.field.priceRound'), type: 'decimal', value: 0 },
              {
                name: 'priceSurcharge',
                label: _('pricing_backend.field.priceSurcharge'),
                type: 'decimal',
                value: 0,
              },
              {
                name: 'priceMinMargin',
                label: _('pricing_backend.field.priceMinMargin'),
                type: 'decimal',
                value: 0,
              },
              {
                name: 'priceMaxMargin',
                label: _('pricing_backend.field.priceMaxMargin'),
                type: 'decimal',
                value: 0,
              },
            ],
          }),
        }),
      }),
    ]),
  )
