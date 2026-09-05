import type { Translator } from '@ketvietlab/ketjs'
import { selectionLabel } from '../../backend/screen.ts'

/** A stable account code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'account_backend', group, value)

export const optionsOf = (_: Translator, group: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: labelOf(_, group, value) }))

/**
 * What to call a document in a list.
 *
 * A journal number is assigned when the entry is posted; until then `name` still
 * holds the raw id it was created under, which is the same illegible shape for
 * every draft on the screen. Its date and reference are what tell them apart.
 */
export const moveTitle = (_: Translator, move: Record<string, unknown>): string =>
  move.state === 'draft'
    ? `${_('account_backend.move.draftTitle')} · ${String(move.accountingDate ?? move.date ?? '').slice(0, 10)}`
    : String(move.name)
