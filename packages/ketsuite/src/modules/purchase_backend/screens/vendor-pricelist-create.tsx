import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  inline,
  linkButton,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { missingSetup, rejection } from './shared.tsx'

export type VendorPricelistCreateScreenOptions = {
  frame: Frame
  fields: FormField[]
  /** Locale-aware `/admin/purchase/vendor-pricelists/new` POST endpoint. */
  action: string
  /** Locale-aware list destination. */
  cancelHref: string
  companyLabel?: string | null
  currency?: unknown
  invalid?: string | null
  setup?: { pickingTypes: number; vendors: number }
}

export const vendorPricelistCreateScreen = (
  _: Translator,
  options: VendorPricelistCreateScreenOptions,
): TemplateResult => {
  const formId = 'purchase-vendor-pricelist-create'
  const context = [options.companyLabel, options.currency ? String(options.currency) : null].filter(Boolean)

  return shell(
    _,
    _('purchase_backend.action.addVendorPrice'),
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="purchase-vendor-pricelist-create"
      title={_('purchase_backend.action.addVendorPrice')}
      description={_('purchase_backend.pricelists.title')}
      actions={
        <FormCluster
          label={_('purchase_backend.action.addVendorPrice')}
          forms={[
            button({
              label: _('purchase_backend.action.addVendorPrice'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('purchase_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      meta={context.length ? inline(context.map((value) => badge(String(value), 'neutral'))) : undefined}
      body={stack([
        rejection(_, options.invalid),
        options.setup ? missingSetup(_, options.setup) : null,
        <Section
          title={_('purchase_backend.action.addVendorPrice')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="purchase-vendor-pricelist-create"
                  action={options.action}
                  submit={_('purchase_backend.action.addVendorPrice')}
                  submitVariant="primary"
                  submitPlacement="external"
                  fields={options.fields}
                />
              }
            />
          }
        />,
      ])}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
