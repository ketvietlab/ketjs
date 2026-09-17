// The product template record modal, client side (KetSuite record-modal contract).
//
// The catalogue collection opens a template here, and its create action opens the
// same modal with an empty record. Only the General and Variants tabs are covered
// — Media and the description's rich-text controller stay on the server-rendered
// detail page (`/admin/product/templates/{id}?tab=media`) until a nested-island
// composition path (`recordIsland`) for them is proven elsewhere first.
//
// `product.saveTemplate` does not touch stock tracking or tax — those are separate
// modules' functions (`stock.configureProduct`, `account.setProductTax`), and a
// function handler cannot call another function. So the one "save" command the
// General tab offers runs all three in sequence (`RecordModalCommand.also`),
// skipping whichever module is not installed or not permitted — one button, one
// busy state, one success notice, even though three calls happen underneath.
//
// Bundled by tools/build-backend-client.mjs into product_backend/client/.

import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  Notice,
  RecordActions,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldOption, FieldProps, MenuEntry } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordCloseTrigger,
  RecordCommandForm,
  RecordDialogTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'

// biome-ignore lint/suspicious/noExplicitAny: rows are JSON shaped by product.templateModalContext
type AnyRow = Record<string, any>

export type TemplateRecord = {
  id: string
  name: string
  type: string
  categoryId: string | null
  brandId: string | null
  uomId: string | null
  origin: string | null
  description: string | null
  listPrice: string
  saleOk: boolean
  purchaseOk: boolean
  defaultCode: string | null
  barcode: string | null
  active: boolean
  isStorable: boolean
  tracking: string
  taxId: string | null
}

export type TemplateModalData = {
  record: TemplateRecord
  variants: AnyRow[]
  hasVariants: boolean
  attributeLines: AnyRow[]
  attributes: FieldOption[]
  attributeValuesByAttribute: Record<string, FieldOption[]>
  types: string[]
  categories: FieldOption[]
  uoms: FieldOption[]
  brands: FieldOption[]
  taxes: FieldOption[]
  stockEnabled: boolean
  taxEnabled: boolean
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
  /** Tabs other modules add through `product_backend:template.recordTabs`. */
  extensionTabs?: Array<{ id: string; label: string; island: string }>
}

type Context = RecordModalContext<TemplateModalData>

const COMMAND_FIELD = '__command'
const TRACKING = ['none', 'lot', 'serial'] as const

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'

const t = (c: Context, key: string, params?: Record<string, unknown>): string =>
  c.t(`product_backend.${key}`, params)

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim()
const checked = (form: FormData, name: string): boolean =>
  ['1', 'on', 'true'].includes(String(form.get(name) ?? ''))
const decimal = (form: FormData, name: string, fallback = '0'): string => {
  const raw = text(form, name)
  return raw === '' ? fallback : raw
}
const money = (value: string | number): string => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toLocaleString('vi-VN') : String(value)
}

const canSave = (c: Context): boolean => c.data.permissions.save === true

const fieldId = (name: string): string => `product-template-${name}`

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: fieldId(props.name),
  value:
    props.type === 'checkbox'
      ? c.draftChecked(props.name, '1', props.value === true || props.value === '1')
      : props.type === 'checkbox-group'
        ? props.value
        : c.draft(props.name, String(props.value ?? '')),
  options:
    props.type === 'checkbox-group'
      ? props.options?.map((option) => ({
          ...option,
          checked: c.draftChecked(option.name ?? `${props.name}[]`, option.value, option.checked === true),
        }))
      : props.options,
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !canSave(c),
})

const stateSelect = (
  c: Context,
  props: { name: string; label: string; value: string; options: FieldOption[]; required?: boolean },
): FieldProps => {
  const base = field(c, { name: props.name, label: props.label, type: 'select', required: props.required })
  return {
    ...base,
    options: props.options,
    control: recordStateSelectControl({
      id: base.id,
      name: props.name,
      state: props.name,
      value: props.value,
      options: props.options,
      required: props.required,
      disabled: base.disabled === true,
      invalid: !!base.error,
    }),
  }
}

const submitButton = (
  c: Context,
  command: string,
  label: string,
  variant: 'primary' | 'secondary' = 'primary',
) => Button({ type: 'submit', name: COMMAND_FIELD, value: command, label, variant, loading: c.busy })

/**
 * A bare form for an action that names no field of its own — generate, remove.
 * `data-layout="actions"` opts the form out of the record-form grid (built for a
 * field/label pair), which would otherwise stretch this lone button to fill it.
 */
const actionForm = (c: Context, command: string, hidden: Record<string, string>, label: string): JSXChild =>
  RecordActionForm({
    kind: c.kind,
    command,
    hidden,
    children: Button({ type: 'submit', label, variant: 'secondary', size: 'compact', loading: c.busy }),
  })

const MORE_FORM_ID = 'product-template-more-form'
const GENERAL_FORM_ID = 'product-template-general-form'

/**
 * A form with no button of its own: every item in the header's "More" menu
 * submits it through the HTML `form` attribute, naming its own command on
 * itself (name/value), so one empty form serves the whole menu.
 */
const menuForm = (c: Context, id: string): JSXChild => RecordCommandForm({ kind: c.kind, id })

/**
 * A labeled Close button placed in the header, next to Save and More.
 * `data-record-close` (not `data-ui="modal-close"`, the icon-only corner
 * control's own attribute) is what the runtime's click handler recognizes.
 */
const closeButton = (c: Context): JSXChild =>
  RecordCloseTrigger({ children: Button({ label: t(c, 'action.close'), variant: 'secondary' }) })

// ── General tab ─────────────────────────────────────────────────────────────

const typeOptions = (c: Context): FieldOption[] =>
  c.data.types.map((type) => ({ value: type, label: t(c, `type.${type}`) }))

const generalFields = (c: Context): FieldProps[] => {
  const record = c.data.record
  return [
    field(c, {
      name: 'businessUse',
      label: t(c, 'field.businessUse'),
      type: 'checkbox-group',
      span: 'full',
      options: [
        { name: 'saleOk', value: '1', label: t(c, 'field.saleOk'), checked: record.saleOk },
        { name: 'purchaseOk', value: '1', label: t(c, 'field.purchaseOk'), checked: record.purchaseOk },
      ],
    }),
    field(c, {
      name: 'type',
      label: t(c, 'field.productKind'),
      type: 'radio',
      value: record.type,
      required: true,
      span: 'full',
      options: typeOptions(c),
    }),
    field(c, { name: 'name', label: t(c, 'field.name'), value: record.name, required: true, span: 'full' }),
    field(c, {
      name: 'uomId',
      label: t(c, 'field.uom'),
      type: 'select',
      value: record.uomId ?? '',
      options: [{ value: '', label: '—' }, ...c.data.uoms],
    }),
    field(c, { name: 'listPrice', label: t(c, 'field.listPrice'), type: 'decimal', value: record.listPrice }),
    field(c, {
      name: 'categoryId',
      label: t(c, 'field.category'),
      type: 'select',
      value: record.categoryId ?? '',
      options: [{ value: '', label: '—' }, ...c.data.categories],
    }),
    field(c, {
      name: 'description',
      label: t(c, 'field.description'),
      type: 'textarea',
      value: record.description,
      span: 'full',
    }),
    ...(c.data.hasVariants
      ? []
      : [
          field(c, { name: 'defaultCode', label: t(c, 'field.defaultCode'), value: record.defaultCode }),
          field(c, { name: 'barcode', label: t(c, 'field.barcode'), value: record.barcode }),
        ]),
    field(c, {
      name: 'brandId',
      label: t(c, 'field.brand'),
      type: 'select',
      value: record.brandId ?? '',
      options: [{ value: '', label: '—' }, ...c.data.brands],
    }),
    field(c, { name: 'origin', label: t(c, 'field.origin'), value: record.origin, span: 'full' }),
  ]
}

const trackingFields = (c: Context): FieldProps[] => [
  field(c, {
    name: 'isStorable',
    label: t(c, 'field.isStorable'),
    type: 'checkbox',
    value: c.data.record.isStorable,
  }),
  field(c, {
    name: 'tracking',
    label: t(c, 'field.tracking'),
    type: 'select',
    value: c.data.record.tracking,
    options: TRACKING.map((value) => ({ value, label: t(c, `tracking.${value}`) })),
  }),
]

const taxFields = (c: Context): FieldProps[] => [
  field(c, {
    name: 'taxId',
    label: t(c, 'field.taxRate'),
    type: 'select',
    value: c.data.record.taxId ?? '',
    options: [{ value: '', label: '—' }, ...c.data.taxes],
  }),
]

const generalTab = (c: Context): JSXChild => {
  const editable = canSave(c)
  return Section({
    title: t(c, 'tabs.general'),
    body: Stack({
      gap: 'compact',
      items: [
        editable ? '' : Notice({ title: t(c, 'readOnly.title'), message: t(c, 'readOnly.message') }),
        RecordModalForm({
          // No button of its own: the header's "Lưu" button submits this form by
          // id (see `GENERAL_FORM_ID`), so it reads as one save action next to
          // Close and More rather than a fourth button buried in the tab body.
          id: GENERAL_FORM_ID,
          kind: c.kind,
          fields: [
            ...generalFields(c),
            ...(c.data.stockEnabled ? trackingFields(c) : []),
            ...(c.data.taxEnabled ? taxFields(c) : []),
          ],
        }),
      ],
    }),
  })
}

// ── Variants tab ─────────────────────────────────────────────────────────────

const attributeLineRows = (c: Context): JSXChild =>
  c.data.attributeLines.length
    ? DataTable<AnyRow>({
        rows: c.data.attributeLines,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'attribute',
            label: t(c, 'attributes.nameColumn'),
            priority: 'primary',
            cell: (row) => String(row.attribute ?? row.attributeId),
          },
          {
            key: 'values',
            label: t(c, 'attributes.values'),
            cell: (row) =>
              (Array.isArray(row.values) ? row.values : [])
                .map((value: AnyRow) => String(value.name))
                .join(' · '),
          },
          {
            key: 'actions',
            label: t(c, 'attributes.actions'),
            cell: (row) =>
              c.data.permissions.removeAttributeLine
                ? actionForm(c, 'removeAttributeLine', { id: String(row.id) }, t(c, 'attributes.removeLine'))
                : '',
          },
        ],
      })
    : Notice({ title: t(c, 'attributes.linesEmpty'), message: t(c, 'attributes.linesEmptyHint') })

const addAttributeLineForm = (c: Context): JSXChild => {
  if (!c.data.permissions.saveAttributeLine || !c.data.attributes.length) return ''
  const attributeId = c.state('attributeId', String(c.data.attributes[0]?.value ?? ''))
  const values = c.data.attributeValuesByAttribute[attributeId] ?? []
  return RecordModalForm({
    kind: c.kind,
    fields: [
      stateSelect(c, {
        name: 'attributeId',
        label: t(c, 'attributes.attribute'),
        value: attributeId,
        required: true,
        options: c.data.attributes.map((row) => ({ value: String(row.value), label: String(row.label) })),
      }),
      field(c, {
        name: 'valueIds',
        label: t(c, 'attributes.values'),
        type: 'checkbox-group',
        span: 'full',
        required: true,
        options: values.map((value) => ({
          name: `value_${value.value}`,
          value: '1',
          label: value.label,
        })),
      }),
    ],
    actions: [submitButton(c, 'saveAttributeLine', t(c, 'attributes.addLine'), 'secondary')],
  })
}

const variantRows = (c: Context): JSXChild =>
  c.data.variants.length
    ? DataTable<AnyRow>({
        rows: c.data.variants,
        id: (row) => String(row.id),
        // No dedicated actions column — narrower than General, it was the one
        // that clipped at a normal modal width. The code cell itself opens the
        // edit dialog, a tertiary button rather than a bordered secondary one so
        // it reads as the row's own identity, not a fifth column competing for
        // the same cramped space.
        columns: [
          {
            key: 'code',
            label: t(c, 'variants.code'),
            priority: 'primary',
            cell: (row) =>
              RecordDialogTrigger({
                dialog: 'variant',
                id: String(row.id),
                children: Button({
                  label: String(row.defaultCode || row.name || row.id),
                  variant: 'tertiary',
                  size: 'compact',
                }),
              }),
          },
          {
            key: 'values',
            label: t(c, 'variants.values'),
            cell: (row) =>
              (Array.isArray(row.values) ? row.values : [])
                .map((value: AnyRow) => String(value.value))
                .join(' · '),
          },
          { key: 'price', label: t(c, 'field.listPrice'), cell: () => money(c.data.record.listPrice) },
          {
            key: 'state',
            label: t(c, 'col.state'),
            cell: (row) =>
              Badge({
                label: row.active === false ? t(c, 'state.archived') : t(c, 'variants.selling'),
                tone: row.active === false ? 'neutral' : 'positive',
              }),
          },
        ],
      })
    : Notice({ title: t(c, 'variants.empty'), message: t(c, 'variants.panelHint') })

const variantsTab = (c: Context): JSXChild =>
  Stack({
    gap: 'loose',
    items: [
      Section({
        title: t(c, 'attributes.panelTitle'),
        description: t(c, 'attributes.panelHint'),
        body: Stack({ gap: 'compact', items: [attributeLineRows(c), addAttributeLineForm(c)] }),
      }),
      Section({
        title: t(c, 'variants.title'),
        description: t(c, 'variants.panelHint'),
        actions: c.data.permissions.generateVariants
          ? actionForm(c, 'generateVariants', {}, t(c, 'variants.generate'))
          : undefined,
        body: variantRows(c),
      }),
    ],
  })

// ── Variant dialog ───────────────────────────────────────────────────────────

const editedVariant = (c: Context): AnyRow | undefined =>
  c.data.variants.find((variant) => String(variant.id) === c.dialog?.params.id)

const variantDialogView = (c: Context): JSXChild => {
  const variant = editedVariant(c)
  if (!variant) return Notice({ title: t(c, 'variants.empty'), message: '' })
  return RecordModalForm({
    kind: c.kind,
    fields: [
      field(c, { name: 'defaultCode', label: t(c, 'field.defaultCode'), value: variant.defaultCode }),
      field(c, { name: 'barcode', label: t(c, 'field.barcode'), value: variant.barcode }),
      field(c, { name: 'weight', label: t(c, 'field.weight'), type: 'decimal', value: variant.weight ?? 0 }),
      field(c, { name: 'volume', label: t(c, 'field.volume'), type: 'decimal', value: variant.volume ?? 0 }),
    ],
    actions: c.data.permissions.saveVariant ? [submitButton(c, 'variantSave', t(c, 'action.save'))] : [],
  })
}

// ── Header / create ──────────────────────────────────────────────────────────

/**
 * Archive and delete share one "More" menu instead of sitting in the header as
 * their own buttons — archive toggles by submitting the hidden `menuForm` above
 * through its HTML `form` attribute; delete carries no form of its own; `run()`
 * routes it to `commands.delete`, whose `confirm` gate asks before anything runs.
 */
const moreMenuItems = (c: Context): MenuEntry[] => {
  const items: MenuEntry[] = []
  if (c.data.permissions.archive)
    items.push({
      id: 'archive',
      label: c.data.record.active ? t(c, 'archive.action') : t(c, 'archive.restore'),
      name: COMMAND_FIELD,
      value: 'archive',
      form: MORE_FORM_ID,
    })
  if (c.data.permissions.delete)
    items.push({
      id: 'delete',
      label: t(c, 'action.delete'),
      name: COMMAND_FIELD,
      value: 'delete',
      form: MORE_FORM_ID,
      destructive: true,
    })
  return items
}

/** The record's active/archived state, beside the modal's own title — not a second line. */
const statusBadge = (c: Context): JSXChild =>
  c.creating
    ? ''
    : Badge({
        label: c.data.record.active ? t(c, 'state.active') : t(c, 'state.archived'),
        tone: c.data.record.active ? 'positive' : 'neutral',
      })

/**
 * The footer carries the action row — Save, Close, then More — outside the
 * scrolling body and the same on every tab, so it reads as one fixed place to
 * finish with the record instead of a button buried in whichever tab happens
 * to hold it. The title and its state already sit in the modal's own chrome
 * (`templateModalDefinition.status`); repeating the name here would just be a
 * second line saying the same thing.
 */
const actions = (c: Context): JSXChild | undefined => {
  if (c.creating) return undefined
  const editable = canSave(c)
  const menuItems = moreMenuItems(c)
  return Stack({
    gap: 'compact',
    items: [
      // Its own form, independent of the General tab's fields: archiving or
      // deleting must not carry — or silently discard — a half-typed edit.
      menuItems.length ? menuForm(c, MORE_FORM_ID) : '',
      RecordActions({
        label: t(c, 'action.more'),
        actions: [
          editable
            ? Button({
                type: 'submit',
                name: COMMAND_FIELD,
                value: 'save',
                label: t(c, 'action.save'),
                variant: 'primary',
                loading: c.busy,
                form: GENERAL_FORM_ID,
                // The General tab's form only exists in the DOM while that tab is
                // active (the other tab's content isn't mounted) — disabled rather
                // than silently doing nothing when there is no form to submit.
                disabled: c.tab !== 'general',
              })
            : '',
          closeButton(c),
          menuItems.length
            ? ActionMenu({
                id: 'product-template-more',
                label: t(c, 'action.more'),
                triggerLabel: t(c, 'action.moreShort'),
                items: menuItems,
                // The trigger sits in the footer, at the sheet's bottom edge — opening
                // downward like the default would run past it and be clipped, since
                // the sheet itself clips overflow.
                placement: 'top',
              })
            : '',
        ],
      }),
    ],
  })
}

const createView = (c: Context): JSXChild =>
  Section({
    title: t(c, 'create.title'),
    description: t(c, 'create.subtitle'),
    body: RecordModalForm({
      kind: c.kind,
      fields: [
        field(c, {
          name: 'type',
          label: t(c, 'field.productKind'),
          type: 'radio',
          value: 'goods',
          required: true,
          span: 'full',
          options: typeOptions(c),
        }),
        field(c, { name: 'name', label: t(c, 'field.name'), required: true, span: 'full' }),
        field(c, {
          name: 'uomId',
          label: t(c, 'field.uom'),
          type: 'select',
          options: [{ value: '', label: '—' }, ...c.data.uoms],
        }),
        field(c, {
          name: 'categoryId',
          label: t(c, 'field.category'),
          type: 'select',
          options: [{ value: '', label: '—' }, ...c.data.categories],
        }),
        field(c, { name: 'listPrice', label: t(c, 'field.listPrice'), type: 'decimal', value: '0' }),
        field(c, { name: 'description', label: t(c, 'field.description'), type: 'textarea', span: 'full' }),
      ],
      actions: [submitButton(c, 'create', t(c, 'action.create'))],
    }),
  })

// ── Definition ────────────────────────────────────────────────────────────────

export const templateModalDefinition: RecordModalDefinition<TemplateModalData> = {
  kind: 'product.template',
  size: 'large',
  // General's own fields fit well inside this; a shorter screen still shrinks it
  // instead of overflowing (see `ModalSheet.fixedHeight`).
  fixedHeight: 'min(48rem, calc(100dvh - var(--kv-space-12)))',
  context: {
    fn: 'product.templateModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'create.title') : c.data.record.name),
  status: statusBadge,
  actions,
  body: (c) => (c.creating ? createView(c) : ''),
  tabs: [
    { id: 'general', label: (c) => t(c, 'tabs.general'), visible: (c) => !c.creating, view: generalTab },
    { id: 'variants', label: (c) => t(c, 'tabs.variants'), visible: (c) => !c.creating, view: variantsTab },
  ],
  extensionTabs: (c) =>
    c.creating
      ? []
      : (c.data.extensionTabs ?? []).map((tab) => ({
          id: tab.id,
          label: () => tab.label,
          view: (context: Context) =>
            recordIsland(tab.island, { templateId: context.id, locale: context.data.lang }),
        })),
  dialogs: {
    variant: { title: (c) => t(c, 'variants.edit'), view: variantDialogView },
  },
  commands: {
    create: {
      fn: 'product.saveTemplate',
      input: (form) => ({
        id: uuid(),
        name: text(form, 'name'),
        type: text(form, 'type') || 'goods',
        uomId: text(form, 'uomId') || null,
        categoryId: text(form, 'categoryId') || null,
        listPrice: decimal(form, 'listPrice'),
        description: text(form, 'description') || null,
      }),
      after: 'open',
      openTab: 'general',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
    // One button, three calls in sequence: the core template fields always save;
    // stock tracking and tax each run only when their module is installed and the
    // viewer may configure it — the same gating the three separate buttons used
    // to carry individually.
    save: {
      fn: 'product.saveTemplate',
      input: (form, c) => ({
        id: c.id,
        name: text(form, 'name'),
        type: text(form, 'type') || 'goods',
        uomId: text(form, 'uomId') || null,
        categoryId: text(form, 'categoryId') || null,
        brandId: text(form, 'brandId') || null,
        origin: text(form, 'origin') || null,
        description: text(form, 'description') || null,
        listPrice: decimal(form, 'listPrice'),
        saleOk: checked(form, 'saleOk'),
        purchaseOk: checked(form, 'purchaseOk'),
        ...(c.data.hasVariants
          ? {}
          : { defaultCode: text(form, 'defaultCode') || null, barcode: text(form, 'barcode') || null }),
      }),
      also: [
        {
          fn: 'stock.configureProduct',
          when: (c) => c.data.stockEnabled && c.data.permissions.configureStock,
          input: (form, c) => ({
            templateId: c.id,
            isStorable: checked(form, 'isStorable'),
            tracking: text(form, 'tracking') || 'none',
          }),
        },
        {
          fn: 'account.setProductTax',
          when: (c) => c.data.taxEnabled && c.data.permissions.setTax,
          input: (form, c) => ({ templateId: c.id, taxId: text(form, 'taxId') || null }),
        },
      ],
      after: 'refresh',
    },
    archive: {
      fn: 'product.archiveTemplate',
      input: (_form, c) => ({ id: c.id, active: !c.data.record.active }),
      after: 'refresh',
    },
    delete: {
      fn: 'product.deleteTemplates',
      input: (_form, c) => ({ ids: [c.id] }),
      confirm: (c) => t(c, 'archive.deleteConfirm', { name: c.data.record.name }),
      after: 'close',
    },
    generateVariants: {
      fn: 'product.generateVariants',
      input: (_form, c) => ({ templateId: c.id }),
      after: 'refresh',
    },
    saveAttributeLine: {
      fn: 'product.saveAttributeLine',
      input: (form, c) => {
        const attributeId = text(form, 'attributeId')
        const values = c.data.attributeValuesByAttribute[attributeId] ?? []
        const valueIds = values
          .map((value) => String(value.value))
          .filter((id) => checked(form, `value_${id}`))
        return { id: uuid(), templateId: c.id, attributeId, valueIds }
      },
      after: 'refresh',
    },
    removeAttributeLine: {
      fn: 'product.removeAttributeLine',
      input: (form) => ({ id: text(form, 'id') }),
      after: 'refresh',
    },
    variantSave: {
      fn: 'product.saveVariant',
      input: (form, c) => ({
        id: c.dialog?.params.id ?? '',
        templateId: c.id,
        defaultCode: text(form, 'defaultCode') || null,
        barcode: text(form, 'barcode') || null,
        weight: decimal(form, 'weight'),
        volume: decimal(form, 'volume'),
      }),
      after: 'reload',
    },
  },
}

export const templateModal = createRecordModal(templateModalDefinition)
