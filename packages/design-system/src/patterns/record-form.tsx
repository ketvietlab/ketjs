import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup, Button, LinkButton } from '../primitives/actions.tsx'
import type { ActionVariant } from '../primitives/actions.tsx'
import { Field } from '../primitives/field.tsx'
import type { FieldProps } from '../primitives/field.tsx'

export const HOOKS = ['record-form', 'form-errors', 'form-grid', 'form-actions'] as const

export type RecordFormProps = {
  id?: string | null
  action: string
  method?: 'get' | 'post'
  fields: readonly FieldProps[]
  submitLabel: string
  submitVariant?: ActionVariant
  cancelHref?: string | null
  cancelLabel?: string | null
  errors?: readonly string[]
  hidden?: Record<string, string>
}

export const RecordForm = (props: RecordFormProps): TemplateResult => (
  <form
    data-ui="record-form"
    id={props.id ?? undefined}
    action={props.action}
    method={props.method ?? 'post'}
  >
    {Object.entries(props.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    {!!props.errors?.length && (
      <ul data-ui="form-errors" role="alert">
        {each(
          props.errors,
          (error, index) => `${index}:${error}`,
          (error) => (
            <li>{error}</li>
          ),
        )}
      </ul>
    )}
    <div data-ui="form-grid">
      {each(
        props.fields,
        (field) => field.id,
        (field) => (
          <Field {...field} />
        ),
      )}
    </div>
    <div data-ui="form-actions">
      <ActionGroup
        actions={[
          <Button label={props.submitLabel} variant={props.submitVariant ?? 'primary'} type="submit" />,
          ...(props.cancelHref
            ? [
                <LinkButton
                  label={props.cancelLabel ?? 'Cancel'}
                  href={props.cancelHref}
                  variant="tertiary"
                />,
              ]
            : []),
        ]}
      />
    </div>
  </form>
)
