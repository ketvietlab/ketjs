import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { linkButton, Notice } from '../../../ui/index.ts'

/** A rejected purchase action must remain visible after its redirect. */
export const rejection = (_: Translator, invalid?: string | null): TemplateResult | null =>
  invalid ? (
    <Notice
      tone="danger"
      title={_('purchase_backend.feedback.rejected')}
      message={
        invalid === '1'
          ? _('purchase_backend.feedback.rejectedHint')
          : _('purchase_backend.feedback.rejectedField', { field: invalid })
      }
    />
  ) : null

/** What the purchase surfaces need configured before operational records can be raised. */
export const missingSetup = (
  _: Translator,
  options: { pickingTypes: number; vendors: number },
): TemplateResult | null => {
  if (options.pickingTypes && options.vendors) return null
  const missing = [
    ...(options.vendors ? [] : [_('purchase_backend.setup.vendors')]),
    ...(options.pickingTypes ? [] : [_('purchase_backend.setup.pickingTypes')]),
  ]
  return (
    <Notice
      tone="warning"
      title={_('purchase_backend.setup.title')}
      message={_('purchase_backend.setup.hint', { missing: missing.join(', ') })}
      actions={linkButton({
        label: options.vendors
          ? _('purchase_backend.setup.openInventory')
          : _('purchase_backend.setup.openPartners'),
        href: options.vendors ? '/admin/stock/picking-types' : '/admin/partner/partners',
        variant: 'primary',
      })}
    />
  )
}
