import type { Translator } from '@ketvietlab/ketjs'
import { selectionLabel as resolveSelection } from '../../backend/screen.ts'

export const pricingSelectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'pricing_backend', group, value)

export type PricelistRow = {
  id: string
  name: string
  currency: string
  state: string
  sequence: string
  detailHref: string
}

export type PricelistValues = {
  id?: string
  name?: string
  sequence?: string | number
  currency?: string
  active?: boolean
}

export type PricelistItemValues = Record<string, unknown> & { id?: string }
