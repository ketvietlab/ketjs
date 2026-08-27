import type { Translator } from '@ketvietlab/ketjs'
import { selectionLabel } from '../../backend/screen.ts'

/** A stable sale code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'sale_backend', group, value)
