import { signal } from '@ketvietlab/ketjs-view'
import { Button, Notice, Section } from '@ketvietlab/design-system'
import { callRecordFunction } from './record-modal.tsx'
import { RecordModalForm } from './record-modal-form.tsx'
import type { VariantEditorAttribute } from './variant-editor-view.tsx'

/** Creates a shared attribute without replacing the variant editor's unsaved setup. */
export const createVariantAttributeForm = (props: {
  id: string
  kind: string
  enabled: boolean
  launcher?: boolean
  returnFocus?: () => void
  disabled: () => boolean
  t: (key: string) => string
  added: (attribute: VariantEditorAttribute) => void
}) => {
  const open = signal(false)
  const busy = signal(false)
  const name = signal('')
  const values = signal('')
  const errors = signal<Record<string, string>>({})
  const failure = signal(false)
  let attributeId = ''
  let disposed = false
  const valueIds = new Map<string, string>()
  const formId = `${props.id}-create-attribute`
  const focus = (id: string) =>
    queueMicrotask(() => {
      if (disposed) return
      const target = document.getElementById(id)
      ;(target?.querySelector('button') ?? target)?.focus()
    })
  const close = () => {
    open.set(false)
    name.set('')
    values.set('')
    errors.set({})
    failure.set(false)
    valueIds.clear()
    if (props.returnFocus) queueMicrotask(props.returnFocus)
    else focus(`${formId}-toggle`)
  }
  const submit = async (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!props.enabled || props.disabled() || busy()) return
    const names = values()
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean)
    const invalid: Record<string, string> = {}
    if (!name().trim()) invalid.name = props.t('attributeNameRequired')
    if (!names.length) invalid.values = props.t('attributeValuesRequired')
    if (new Set(names.map((value) => value.normalize('NFC').toLowerCase())).size !== names.length)
      invalid.values = props.t('attributeValuesDuplicate')
    errors.set(invalid)
    failure.set(false)
    if (Object.keys(invalid).length) {
      focus(`${formId}-${invalid.name ? 'name' : 'values'}`)
      return
    }
    const input = {
      id: attributeId,
      name: name().trim(),
      displayType: 'select',
      createVariant: 'always',
      values: names.map((value) => {
        if (!valueIds.has(value)) valueIds.set(value, crypto.randomUUID())
        return { id: valueIds.get(value)!, name: value }
      }),
    }
    busy.set(true)
    try {
      const result = await callRecordFunction('product.saveAttributeDraft', input)
      if (disposed) return
      if (!result.ok) {
        const fields: Record<string, string> = {}
        for (const issue of result.issues) {
          if (issue.field === 'name')
            fields.name = props.t(
              issue.code === 'product.error.attribute.duplicateName'
                ? 'attributeNameDuplicate'
                : 'attributeNameRequired',
            )
          else if (issue.field?.startsWith('values')) fields.values = props.t('attributeValuesInvalid')
        }
        errors.set(fields)
        failure.set(!Object.keys(fields).length)
        focus(`${formId}-${fields.name ? 'name' : fields.values ? 'values' : 'submit'}`)
        return
      }
      props.added({
        attributeId: input.id,
        name: input.name,
        createVariant: input.createVariant,
        values: input.values.map((value) => ({ valueId: value.id, name: value.name })),
      })
      document.dispatchEvent(
        new CustomEvent('ket:records-changed', {
          detail: { kind: 'product.attribute', ids: [input.id] },
        }),
      )
      close()
    } catch {
      if (disposed) return
      failure.set(true)
      focus(`${formId}-submit`)
    } finally {
      busy.set(false)
    }
  }
  return {
    open,
    busy,
    start: (query = '') => {
      if (!props.enabled || props.disabled() || busy()) return
      attributeId = crypto.randomUUID()
      name.set(query)
      open.set(true)
      focus(`${formId}-name`)
    },
    attach: (root: HTMLElement, lifetime: AbortSignal) => {
      lifetime.addEventListener('abort', () => {
        disposed = true
      })
      root.addEventListener(
        'click',
        (event) => {
          const button = event.target instanceof Element ? event.target.closest('button') : null
          if (!props.enabled || !button || button.disabled || busy() || props.disabled()) return
          if (button.name === 'createAttribute') {
            attributeId = crypto.randomUUID()
            open.set(true)
            focus(`${formId}-name`)
          } else if (button.name === 'cancelAttribute') close()
        },
        { signal: lifetime },
      )
    },
    view: () =>
      !props.enabled || (props.launcher === false && !open()) ? null : (
        <div
          onInput={(event: Event) => {
            const input = event.target
            if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return
            if (input.name === 'attributeName') name.set(input.value)
            if (input.name === 'attributeValues') values.set(input.value)
          }}
          onSubmit={submit}
        >
          {!open() ? (
            <span id={`${formId}-toggle`} tabIndex={-1}>
              <Button name="createAttribute" label={props.t('createAttribute')} disabled={props.disabled()} />
            </span>
          ) : (
            <Section
              title={props.t('createAttribute')}
              description={props.t('createAttributeHint')}
              body={
                <>
                  {failure() ? (
                    <Notice
                      tone="danger"
                      title={props.t('attributeCreateFailed')}
                      message={props.t('attributeRetryHint')}
                    />
                  ) : null}
                  <RecordModalForm
                    id={formId}
                    kind={props.kind}
                    dirty={!!name() || !!values()}
                    fields={[
                      {
                        id: `${formId}-name`,
                        name: 'attributeName',
                        label: props.t('attributeName'),
                        value: name(),
                        required: true,
                        disabled: busy(),
                        error: errors().name,
                        placeholder: props.t('attributeNameExample'),
                        span: 'full',
                      },
                      {
                        id: `${formId}-values`,
                        name: 'attributeValues',
                        label: props.t('attributeValues'),
                        type: 'textarea',
                        value: values(),
                        required: true,
                        disabled: busy(),
                        error: errors().values,
                        help: props.t('attributeValuesHint'),
                        placeholder: props.t('attributeValuesExample'),
                        span: 'full',
                      },
                    ]}
                    actions={[
                      <span id={`${formId}-submit`} tabIndex={-1}>
                        <Button
                          type="submit"
                          label={props.t('createAndAddAttribute')}
                          variant="primary"
                          loading={busy()}
                        />
                      </span>,
                      <Button
                        name="cancelAttribute"
                        label={props.t('cancelAttribute')}
                        variant="tertiary"
                        disabled={busy()}
                      />,
                    ]}
                  />
                </>
              }
            />
          )}
        </div>
      ),
  }
}
