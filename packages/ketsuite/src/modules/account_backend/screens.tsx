import type { Translator } from '@ketvietlab/ketjs'
import { selectionLabel } from '../backend/screen.ts'

/** A stable account code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'account_backend', group, value)

export const optionsOf = (_: Translator, group: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: labelOf(_, group, value) }))
