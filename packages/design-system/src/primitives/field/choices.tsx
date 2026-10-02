import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { FieldProps } from './index.tsx'
import { describedBy } from './frame.tsx'
import { Text } from '../status/index.tsx'

export const ChoiceControls = (props: FieldProps): TemplateResult => {
  const radio = props.type === 'radio'
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: both group and radiogroup support aria-labelledby.
    <div
      data-ui="field-options"
      data-orientation={props.optionsOrientation === 'vertical' ? 'vertical' : null}
      role={radio ? 'radiogroup' : 'group'}
      aria-labelledby={`${props.id}-label`}
      aria-describedby={describedBy(props.id, props.help, props.error)}
      aria-invalid={props.error ? 'true' : null}
    >
      {each(
        props.options ?? [],
        (option) => option.name ?? option.value,
        (option) => (
          <label data-ui="field-option">
            <input
              data-ui="field-option-input"
              type={radio ? 'radio' : 'checkbox'}
              name={radio ? props.name : (option.name ?? `${props.name}[]`)}
              value={option.value}
              checked={radio ? String(props.value ?? '') === option.value : option.checked === true}
              required={radio && props.required === true}
              disabled={props.disabled === true || option.disabled === true}
              aria-invalid={props.error ? 'true' : null}
              aria-describedby={describedBy(props.id, props.help, props.error)}
              autocomplete="off"
            />
            <Text>{option.label}</Text>
          </label>
        ),
      )}
    </div>
  )
}
