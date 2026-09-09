import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Combobox } from '../combobox/index.tsx'
import type { ComboboxOption, ComboboxProps } from '../combobox/index.tsx'

export const HOOKS = ['relation-picker'] as const

export type RelationPickerProps<T> = Omit<ComboboxProps, 'options'> & {
  results: readonly T[]
  getValue: (result: T) => string
  getLabel: (result: T) => string
  getDescription?: (result: T) => string | undefined
}

/** The application supplies permission-filtered results; this renderer performs no lookup. */
export const RelationPicker = <T,>(props: RelationPickerProps<T>): TemplateResult => {
  const options: ComboboxOption[] = props.results.map((result) => ({
    value: props.getValue(result),
    label: props.getLabel(result),
    description: props.getDescription?.(result),
  }))
  return (
    <div data-ui="relation-picker">
      <Combobox {...props} options={options} />
    </div>
  )
}
