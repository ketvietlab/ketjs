import type { Translator } from '@ketvietlab/ketjs'

export const labelOf = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value ?? '')
  const key = `account_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

export const optionsOf = (_: Translator, group: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: labelOf(_, group, value) }))
