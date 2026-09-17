// The product template record modal, client side (KetSuite record-modal contract).
//
// The catalogue collection opens a template here, and its create action opens the
// same modal with an empty record. Only the General and Attributes & variants tabs are covered
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

import { ActionMenu, Badge, Button, Notice, RecordActions, Section, Stack } from '@ketvietlab/design-system'
import type {
  FieldOption,
  FieldProps,
  MenuEntry,
  RelationManager,
  RelationSelectConfig,
  RelationSelectLabels,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import type { VariantEditorSetup } from '../../../ui/client/variant-editor-view.tsx'
import {
  RecordCloseTrigger,
  RecordCommandForm,
  RecordFormWithImage,
  RecordImageField,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'

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

export type TemplateImage = { mediaId: string; attachmentId: string; alt: string | null; primary: boolean }

export type TemplateModalData = {
  record: TemplateRecord
  /** Primary first; the thumbnail shows the first, the viewer pages through all. */
  images: TemplateImage[]
  hasVariants: boolean
  variantSetup: VariantEditorSetup | null
  types: string[]
  categories: FieldOption[]
  uoms: FieldOption[]
  brands: FieldOption[]
  taxes: FieldOption[]
  stockEnabled: boolean
  taxEnabled: boolean
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
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
const canSave = (c: Context): boolean => c.data.permissions.save === true

/**
 * `backend.relation-select`'s own labels, read straight off this modal's context —
 * the shared `relationLabels` in `backend/relation-select.ts` takes a full
 * `Translator`, which `c.t` (a plain `(key, params?) => string`) does not satisfy.
 */
const relationLabels = (c: Context, dialogTitle: string): RelationSelectLabels => ({
  choose: c.t('backend.relation.choose'),
  search: c.t('backend.relation.search'),
  more: c.t('backend.relation.more'),
  noRecords: c.t('backend.relation.noRecords'),
  loading: c.t('backend.relation.loading'),
  loadError: c.t('backend.relation.loadError'),
  dialogTitle,
  close: c.t('backend.relation.close'),
  select: c.t('backend.relation.select'),
  create: c.t('backend.relation.create'),
  edit: c.t('backend.relation.edit'),
  save: c.t('backend.relation.save'),
  cancel: c.t('backend.relation.cancel'),
  remove: c.t('backend.relation.remove'),
  confirmRemove: c.t('backend.relation.confirmRemove'),
  retry: c.t('backend.relation.retry'),
  clear: c.t('backend.relation.clear'),
  chosen: c.t('backend.relation.chosen'),
})

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

/**
 * A relational field, as a search-and-create picker rather than a bare select —
 * the same `backend.relation-select` island the server-rendered detail page used
 * before General moved into this modal. Cold-mounted via `recordIsland`: nothing
 * here needs a route, only the JSON config the island reads on the client.
 */
const relationField = (
  c: Context,
  props: {
    name: string
    label: string
    value: string | null
    options: FieldOption[]
    dialogTitle: string
    manager: RelationManager
    required?: boolean
  },
): FieldProps => {
  const base = field(c, {
    name: props.name,
    label: props.label,
    type: 'select',
    required: props.required,
    value: props.value ?? '',
  })
  const config: RelationSelectConfig = {
    name: props.name,
    ariaLabel: props.label,
    value: (base.value as string) || null,
    required: props.required,
    disabled: base.disabled === true,
    options: props.options,
    labels: relationLabels(c, props.dialogTitle),
    manager: props.manager,
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id, config }) }
}

const categoryField = (c: Context): FieldProps =>
  relationField(c, {
    name: 'categoryId',
    label: t(c, 'field.category'),
    value: c.data.record.categoryId,
    options: [{ value: '', label: '—' }, ...c.data.categories],
    dialogTitle: t(c, 'relation.categories'),
    manager: {
      listFunction: 'product.listCategories',
      descriptionField: 'path',
      saveFunction: 'product.saveCategory',
      fields: [{ name: 'name', label: t(c, 'field.category'), required: true }],
    },
  })

const brandField = (c: Context): FieldProps =>
  relationField(c, {
    name: 'brandId',
    label: t(c, 'field.brand'),
    value: c.data.record.brandId,
    options: [{ value: '', label: '—' }, ...c.data.brands],
    dialogTitle: t(c, 'relation.brands'),
    manager: {
      listFunction: 'product.listBrands',
      saveFunction: 'product.saveBrand',
      fields: [{ name: 'name', label: t(c, 'field.brand'), required: true }],
    },
  })

const uomField = (c: Context): FieldProps =>
  relationField(c, {
    name: 'uomId',
    label: t(c, 'field.uom'),
    value: c.data.record.uomId,
    options: [{ value: '', label: '—' }, ...c.data.uoms],
    dialogTitle: t(c, 'relation.units'),
    manager: {
      listFunction: 'uom.listUnits',
      saveFunction: 'uom.saveUnit',
      fields: [
        { name: 'name', label: t(c, 'field.uom'), required: true },
        { name: 'relativeFactor', label: t(c, 'relation.unitFactor'), required: true },
      ],
    },
  })

const submitButton = (
  c: Context,
  command: string,
  label: string,
  variant: 'primary' | 'secondary' = 'primary',
) => Button({ type: 'submit', name: COMMAND_FIELD, value: command, label, variant, loading: c.busy })

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
    uomField(c),
    field(c, { name: 'listPrice', label: t(c, 'field.listPrice'), type: 'decimal', value: record.listPrice }),
    categoryField(c),
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
    brandField(c),
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

// ── Main image ───────────────────────────────────────────────────────────────

/** The stored file at a rendition size; the file route serves the original until the job made one. */
export const imageUrl = (attachmentId: string, size: 'thumb' | 'medium' | 'large'): string =>
  `/files/${encodeURIComponent(attachmentId)}?size=${size}`

/** `backend.lightbox`'s labels, off this modal's own messages. */
export const lightboxLabels = (c: Context) => ({
  open: t(c, 'image.open'),
  close: t(c, 'image.close'),
  previous: t(c, 'image.previous'),
  next: t(c, 'image.next'),
  zoomIn: t(c, 'image.zoomIn'),
  zoomOut: t(c, 'image.zoomOut'),
  counter: t(c, 'image.counter'),
  empty: t(c, 'image.empty'),
})

const IMAGE_FORM_ID = 'product-template-image'

/**
 * The template's main image, at the right of its name and kind. Clicking it opens
 * every template image in the viewer; dropping or choosing a file replaces it.
 */
const imageField = (c: Context): JSXChild => {
  const images = c.data.images
  const name = c.data.record.name
  return RecordImageField({
    kind: c.kind,
    id: IMAGE_FORM_ID,
    busy: c.busy,
    // Keyed by the image set: a new upload is a different viewer, not a prop update.
    viewer: images.length
      ? recordIsland('backend.lightbox', {
          id: `product-template-lightbox-${images.map((image) => image.mediaId).join('-')}`,
          config: {
            thumbnails: 'first',
            size: 'large',
            labels: lightboxLabels(c),
            items: images.map((image) => ({
              src: imageUrl(image.attachmentId, 'large'),
              thumbnail: imageUrl(image.attachmentId, 'thumb'),
              alt: image.alt || name,
              caption: image.alt || null,
            })),
          },
        })
      : null,
    uploadCommand: c.data.permissions.uploadImage ? 'uploadImage' : null,
    removeCommand: c.data.permissions.removeImage && images.length ? 'removeImage' : null,
    labels: {
      empty: t(c, 'image.empty'),
      upload: t(c, 'image.upload'),
      replace: t(c, 'image.replace'),
      remove: t(c, 'image.remove'),
      drop: t(c, 'image.drop'),
    },
  })
}

const generalTab = (c: Context): JSXChild => {
  const editable = canSave(c)
  return Section({
    title: t(c, 'tabs.general'),
    body: Stack({
      gap: 'compact',
      items: [
        editable ? '' : Notice({ title: t(c, 'readOnly.title'), message: t(c, 'readOnly.message') }),
        RecordFormWithImage({
          form: RecordModalForm({
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
          image: imageField(c),
        }),
      ],
    }),
  })
}

// ── Attributes & variants tab ────────────────────────────────────────────────

/** Every label the editor island shows, read off this modal's own messages. */
const VARIANT_EDITOR_LABELS = [
  'attributesTitle',
  'attributesHint',
  'attributesEmpty',
  'attributesEmptyHint',
  'addAttribute',
  'removeAttribute',
  'addValue',
  'removeValue',
  'priceExtra',
  'appliesTo',
  'noVariant',
  'done',
  'variantsTitle',
  'variantsCount',
  'variantsEmpty',
  'variantsEmptyHint',
  'variantsNeedAttributes',
  'generate',
  'addVariant',
  'activateAll',
  'archiveAll',
  'missing',
  'choose',
  'archived',
  'duplicate',
  'incomplete',
  'new',
  'edit',
  'collapse',
  'remove',
  'archive',
  'restore',
  'defaultCode',
  'barcode',
  'weight',
  'volume',
  'listPrice',
  'summaryCreate',
  'summaryArchive',
  'summaryChanged',
  'summaryDuplicate',
  'reset',
  'save',
  'saved',
  'saveFailed',
  'readOnly',
  'image',
  'uploadImage',
  'replaceImage',
  'removeImage',
  'dropImage',
  'imageSaveFirst',
  'imageFailed',
  'imageRemoveConfirm',
] as const

/**
 * The whole tab is one island: attribute lines with their value chips on top, the
 * variant rows below, saved together through `product.saveVariantSetup`. The
 * setup is read by the modal's own context, so opening the tab costs no second
 * request; the island keeps its edits until its own Save or Reset.
 */
const variantsTab = (c: Context): JSXChild =>
  c.data.variantSetup
    ? recordIsland('product.variant-editor', {
        id: `product-variant-editor-${c.id}`,
        kind: c.kind,
        setup: c.data.variantSetup,
        editable: c.data.permissions.saveVariantSetup === true,
        saveFunction: 'product.saveVariantSetup',
        labels: Object.fromEntries(VARIANT_EDITOR_LABELS.map((key) => [key, t(c, `variantEditor.${key}`)])),
        lightboxLabels: lightboxLabels(c),
        media: {
          upload: c.data.permissions.uploadImage === true,
          remove: c.data.permissions.removeImage === true,
        },
      })
    : Notice({ title: t(c, 'variants.empty'), message: t(c, 'variants.panelHint') })

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
    // A new main image: store the file, link it as primary, then drop the image it
    // replaces — one action, so the thumbnail never shows two or none in between.
    uploadImage: {
      fn: 'product_media.attachMedia',
      upload: {
        file: (_form, c) => ({
          resModel: 'product.Template',
          resId: c.id,
          resField: 'media',
          public: 'false',
        }),
      },
      input: (_form, c, uploads) => ({
        id: uploads.file?.id ?? '',
        attachmentId: uploads.file?.id ?? '',
        templateId: c.id,
        alt: uploads.file?.name ?? null,
        primary: true,
      }),
      also: [
        {
          fn: 'product_media.removeMedia',
          when: (c) => c.data.images.some((image) => image.primary),
          input: (_form, c) => ({ id: c.data.images.find((image) => image.primary)?.mediaId ?? '' }),
        },
      ],
      after: 'refresh',
    },
    removeImage: {
      fn: 'product_media.removeMedia',
      input: (_form, c) => ({ id: c.data.images[0]?.mediaId ?? '' }),
      confirm: (c) => t(c, 'image.removeConfirm'),
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
  },
}

export const templateModal = createRecordModal(templateModalDefinition)
