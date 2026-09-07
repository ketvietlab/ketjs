import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { moneyValue } from '../../../ui/primitives.tsx'

type PartnerBalanceProps = { value?: unknown; currency?: unknown }

/** Browser-only presentation for the bridge's exact-decimal balance projection. */
export function partnerBalanceWidget(props: PartnerBalanceProps): TemplateResult {
  return moneyValue(props.value, props.currency, document.documentElement.lang || 'vi')
}
