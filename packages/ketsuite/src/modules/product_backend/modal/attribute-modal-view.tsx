import { ATTRIBUTE_RECORD_MODAL_LABELS } from '../../product/attribute-modal-labels.ts'
import { Button, Field, Grid, RecordActions, ReorderList, Section } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'

export type AttributeValueDraft = { id: string; name: string; htmlColor: string | null; sequence: number }
export type AttributeRecord = {
  id: string
  name: string
  displayType: string
  createVariant: string
  sequence: number
  values: AttributeValueDraft[]
}
export type AttributeModalData = {
  record: AttributeRecord
  permissions: { save: boolean }
  lang: 'vi' | 'en'
}
type Context = RecordModalContext<AttributeModalData>
const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const formId = 'product-attribute-draft'
const orderField = 'attributeValuesOrder'
const t = (c: Context, key: string): string => c.t(`product_backend.${key}`)
const valueField = (id: string, field: string): string => `attributeValue.${id}.${field}`
const valuesOf = (c: Context): AttributeValueDraft[] => {
  const initial = c.data.record.values.map((value) => value.id)
  let ids: string[] = initial
  try {
    const parsed: unknown = JSON.parse(c.state(orderField, JSON.stringify(initial)))
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) ids = [...new Set(parsed)]
  } catch {
    /* A fresh context supplies the canonical order. */
  }
  return ids.map((id, index) => {
    const value = c.data.record.values.find((item) => item.id === id)
    return {
      id,
      name: c.draft(valueField(id, 'name'), value?.name ?? ''),
      htmlColor:
        c.draft(
          valueField(id, 'htmlColor'),
          value?.htmlColor ??
            (c.draft('displayType', c.data.record.displayType) === 'color' ? '#000000' : ''),
        ) || null,
      sequence: index,
    }
  })
}
const draftOf = (c: Context): AttributeRecord => ({
  ...c.data.record,
  name: c.draft('name', c.data.record.name),
  displayType: c.draft('displayType', c.data.record.displayType),
  createVariant: c.draft('createVariant', c.data.record.createVariant),
  values: valuesOf(c),
})
const dirty = (c: Context, draft: AttributeRecord): boolean => {
  const baseline = {
    ...c.data.record,
    values: c.data.record.values.map((value, index) => ({
      id: value.id,
      name: value.name,
      htmlColor: value.htmlColor || (c.data.record.displayType === 'color' ? '#000000' : null),
      sequence: index,
    })),
  }
  return JSON.stringify(draft) !== JSON.stringify(baseline)
}
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: `${formId}-${props.name}`,
  disabled: !c.data.permissions.save || c.busy,
  error: c.fieldError(props.name),
  value: c.draft(props.name, String(props.value ?? '')),
})
const body = (c: Context): JSXChild => {
  const draft = draftOf(c)
  const choices = (group: string, values: string[]) =>
    values.map((value) => ({ value, label: t(c, `${group}.${value}`) }))
  return (
    <RecordModalForm
      kind={c.kind}
      id={formId}
      command="save"
      dirty={dirty(c, draft)}
      fields={[
        field(c, {
          name: 'name',
          label: t(c, 'field.name'),
          value: draft.name,
          required: true,
          span: 'full',
        }),
        {
          ...field(c, {
            name: 'displayType',
            label: t(c, 'attributes.displayType'),
            value: draft.displayType,
          }),
          control: recordStateSelectControl({
            id: `${formId}-displayType`,
            name: 'displayType',
            state: 'displayType',
            value: draft.displayType,
            disabled: !c.data.permissions.save || c.busy,
            options: choices('displayType', ['radio', 'pills', 'select', 'color', 'multi']),
          }),
        },
        field(c, {
          name: 'createVariant',
          label: t(c, 'attributes.createVariant'),
          type: 'select',
          value: draft.createVariant,
          options: choices('createVariant', ['always', 'no_variant']),
        }),
      ]}
      body={
        <Section
          title={t(c, 'attributes.values')}
          description={c.fieldError(orderField)}
          body={
            <ReorderList
              id="product-attribute-values"
              name={orderField}
              label={t(c, 'attributes.values')}
              disabled={!c.data.permissions.save || c.busy}
              labels={{
                add: t(c, 'attributes.addValue'),
                remove: t(c, 'attributes.removeValue'),
                up: t(c, 'attributes.moveUp'),
                down: t(c, 'attributes.moveDown'),
                drag: t(c, 'attributes.dragValue'),
                empty: t(c, 'attributes.emptyValues'),
              }}
              items={draft.values.map((value) => {
                const name = (
                  <Field
                    {...field(c, {
                      name: valueField(value.id, 'name'),
                      label: t(c, 'attributes.valueName'),
                      required: true,
                      value: value.name,
                    })}
                  />
                )
                return {
                  id: value.id,
                  content:
                    draft.displayType === 'color' ? (
                      <Grid
                        columns={2}
                        items={[
                          name,
                          <Field
                            {...field(c, {
                              name: valueField(value.id, 'htmlColor'),
                              label: t(c, 'attributes.color'),
                              type: 'color',
                              value: value.htmlColor || '#000000',
                            })}
                          />,
                        ]}
                      />
                    ) : (
                      name
                    ),
                }
              })}
            />
          }
        />
      }
    />
  )
}
export const attributeModalDefinition: RecordModalDefinition<AttributeModalData> = {
  kind: 'product.attribute',
  labels: () => ATTRIBUTE_RECORD_MODAL_LABELS[pageLang()],
  size: 'large',
  context: {
    fn: 'product.attributeModalContext',
    input: (id, creating) => ({
      ...(creating ? {} : { id }),
      locale: pageLang(),
    }),
  },
  title: (c) => (c.creating ? t(c, 'attributes.createTitle') : c.data.record.name),
  body,
  actions: (c) => (
    <RecordActions
      actions={[
        ...(c.data.permissions.save
          ? [
              <Button
                type="submit"
                form={formId}
                label={t(c, 'action.save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.close')} variant="tertiary" />
        </RecordCloseTrigger>,
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'product.saveAttributeDraft',
      issueField: (path, form, c) => {
        if (path === 'values') return orderField
        const matched = /^values\.(\d+)\.(name|htmlColor|id)$/.exec(path)
        if (!matched) return path
        let ids = valuesOf(c).map((value) => value.id)
        try {
          const parsed: unknown = JSON.parse(String(form.get(orderField) ?? 'null'))
          if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) ids = parsed
        } catch {
          /* Keep the submitted view order fallback. */
        }
        const id = ids[Number(matched[1])]
        return id ? valueField(id, matched[2] === 'id' ? 'name' : matched[2]!) : path
      },
      input: (form, c) => ({
        id: c.creating ? crypto.randomUUID() : c.id,
        name: String(form.get('name') ?? c.draft('name', c.data.record.name)).trim(),
        displayType: String(form.get('displayType') ?? c.data.record.displayType),
        createVariant: String(form.get('createVariant') ?? c.data.record.createVariant),
        sequence: c.data.record.sequence,
        values: valuesOf(c).map((value, index) => ({
          id: value.id,
          name: String(form.get(valueField(value.id, 'name')) ?? value.name).trim(),
          htmlColor:
            String(form.get(valueField(value.id, 'htmlColor')) ?? value.htmlColor ?? '').trim() || null,
          sequence: index,
        })),
      }),
      after: 'close',
    },
  },
}
export const attributeModal = createRecordModal(attributeModalDefinition)
