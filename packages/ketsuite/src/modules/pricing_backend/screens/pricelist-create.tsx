import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { modalForm } from '../../../ui/index.ts'
import type { PricelistValues } from './shared.ts'

export const pricelistCreateModal = (
  _: Translator,
  options: {
    action: string
    closeHref: string
    values: PricelistValues
    errors?: readonly string[]
  },
): TemplateResult =>
  modalForm({
    id: 'pricing-pricelist-create',
    title: _('pricing_backend.create.title'),
    description: _('pricing_backend.create.hint'),
    closeHref: options.closeHref,
    closeLabel: _('pricing_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'pricelist-create-form',
      scope: 'pricing-pricelist-create',
      action: options.action,
      hidden: { action: 'create', ...(options.values.id ? { id: options.values.id } : {}) },
      submit: _('pricing_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.closeHref,
      cancelLabel: _('pricing_backend.action.cancel'),
      errors: options.errors,
      fields: [
        { name: 'name', label: _('pricing_backend.col.name'), value: options.values.name, required: true },
        {
          name: 'sequence',
          label: _('pricing_backend.col.sequence'),
          type: 'number',
          value: options.values.sequence ?? 16,
        },
      ],
    },
  })
