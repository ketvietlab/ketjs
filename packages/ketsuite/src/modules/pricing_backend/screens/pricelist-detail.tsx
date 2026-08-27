import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { pricingSelectionLabel } from './shared.ts'
import type { PricelistItemValues, PricelistValues } from './shared.ts'

const formValue = (value: unknown): string | number | boolean | null | undefined =>
  value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined

export type PricelistDetailScreenOptions = {
  action: string
  cancelHref: string
  values: PricelistValues
  items: readonly Record<string, unknown>[]
  itemValues: PricelistItemValues
  errors?: readonly string[]
  itemErrors?: readonly string[]
}

export const pricelistDetailScreen = (
  _: Translator,
  frame: Frame,
  options: PricelistDetailScreenOptions,
): TemplateResult => {
  const formId = 'pricelist-settings-form'
  const row = options.values
  const item = options.itemValues
  return shell(
    _,
    String(row.name ?? row.id ?? ''),
    <FormPage
      scope="pricelist-detail-page"
      title={String(row.name ?? row.id ?? '')}
      description={String(row.currency ?? '')}
      status={badge(
        pricingSelectionLabel(_, 'state', row.active === false ? 'archived' : 'active'),
        row.active === false ? 'neutral' : 'positive',
        row.active === false ? 'archived' : 'active',
      )}
      actions={
        <FormCluster
          forms={[
            button({
              label: _('pricing_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('pricing_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        <Section
          title={_('pricing_backend.detail.settings')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="pricing-pricelist-settings"
                  action={options.action}
                  submit={_('pricing_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                  hidden={{ action: 'save-pricelist' }}
                  errors={options.errors}
                  fields={[
                    {
                      name: 'name',
                      label: _('pricing_backend.col.name'),
                      value: row.name,
                      required: true,
                    },
                    {
                      name: 'sequence',
                      label: _('pricing_backend.col.sequence'),
                      type: 'number',
                      value: row.sequence,
                    },
                    {
                      name: 'currency',
                      label: _('pricing_backend.col.currency'),
                      value: row.currency,
                      disabled: true,
                    },
                    {
                      name: 'active',
                      label: _('pricing_backend.col.active'),
                      type: 'checkbox',
                      value: row.active,
                    },
                  ]}
                />
              }
            />
          }
        />,
        <Section
          title={_('pricing_backend.items.title')}
          body={
            options.items.length === 0
              ? emptyState(_('pricing_backend.items.empty'), _('pricing_backend.items.hint'))
              : dataTable(_, {
                  rows: options.items,
                  id: (entry) => String(entry.id),
                  columns: [
                    {
                      key: 'appliedOn',
                      label: _('pricing_backend.field.appliedOn'),
                      cell: (entry) => pricingSelectionLabel(_, 'appliedOn', entry.appliedOn),
                    },
                    {
                      key: 'compute',
                      label: _('pricing_backend.field.computePrice'),
                      cell: (entry) => {
                        const value = String(entry.computePrice)
                        return badge(pricingSelectionLabel(_, 'compute', value), 'neutral', value)
                      },
                    },
                    {
                      key: 'quantity',
                      label: _('pricing_backend.field.minQuantity'),
                      cell: (entry) => String(entry.minQuantity),
                    },
                    {
                      key: 'base',
                      label: _('pricing_backend.field.base'),
                      cell: (entry) => pricingSelectionLabel(_, 'base', entry.base),
                    },
                  ],
                })
          }
        />,
        <Section
          title={_('pricing_backend.items.add')}
          description={_('pricing_backend.items.formulaHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={options.action}
                  submit={_('pricing_backend.action.add')}
                  submitVariant="secondary"
                  hidden={{ action: 'add-item', ...(item.id ? { id: String(item.id) } : {}) }}
                  errors={options.itemErrors}
                  fields={[
                    {
                      name: 'appliedOn',
                      label: _('pricing_backend.field.appliedOn'),
                      type: 'select',
                      value: formValue(item.appliedOn),
                      options: ['3_global', '2_product_category', '1_product', '0_product_variant'].map(
                        (value) => ({ value, label: pricingSelectionLabel(_, 'appliedOn', value) }),
                      ),
                    },
                    {
                      name: 'categoryId',
                      label: _('pricing_backend.field.categoryId'),
                      value: formValue(item.categoryId),
                    },
                    {
                      name: 'templateId',
                      label: _('pricing_backend.field.templateId'),
                      value: formValue(item.templateId),
                    },
                    {
                      name: 'productId',
                      label: _('pricing_backend.field.productId'),
                      value: formValue(item.productId),
                    },
                    {
                      name: 'minQuantity',
                      label: _('pricing_backend.field.minQuantity'),
                      type: 'decimal',
                      value: formValue(item.minQuantity) ?? 0,
                    },
                    {
                      name: 'dateStart',
                      label: _('pricing_backend.field.dateStart'),
                      type: 'datetime-local',
                      value: formValue(item.dateStart),
                    },
                    {
                      name: 'dateEnd',
                      label: _('pricing_backend.field.dateEnd'),
                      type: 'datetime-local',
                      value: formValue(item.dateEnd),
                    },
                    {
                      name: 'base',
                      label: _('pricing_backend.field.base'),
                      type: 'select',
                      value: formValue(item.base),
                      options: ['list_price', 'standard_price', 'pricelist'].map((value) => ({
                        value,
                        label: pricingSelectionLabel(_, 'base', value),
                      })),
                    },
                    {
                      name: 'basePricelistId',
                      label: _('pricing_backend.field.basePricelistId'),
                      value: formValue(item.basePricelistId),
                    },
                    {
                      name: 'computePrice',
                      label: _('pricing_backend.field.computePrice'),
                      type: 'select',
                      value: formValue(item.computePrice),
                      options: ['fixed', 'percentage', 'formula'].map((value) => ({
                        value,
                        label: pricingSelectionLabel(_, 'compute', value),
                      })),
                    },
                    ...[
                      'fixedPrice',
                      'percentPrice',
                      'priceDiscount',
                      'priceRound',
                      'priceSurcharge',
                      'priceMinMargin',
                      'priceMaxMargin',
                    ].map((name) => ({
                      name,
                      label: _(`pricing_backend.field.${name}`),
                      type: 'decimal' as const,
                      value: formValue(item[name]) ?? 0,
                    })),
                  ]}
                />
              }
            />
          }
        />,
      ])}
    />,
    { ...frame, topbar: false },
  )
}
