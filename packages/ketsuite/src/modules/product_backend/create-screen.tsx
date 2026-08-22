import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { Framed, icon, RecordForm, RecordToggle, RecordWorkspace } from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'
import { selectionLabel as resolveSelection } from '../backend/screen.ts'

type ProductCreateOptions = {
  uoms: FormOption[]
  categories: FormOption[]
  stockEnabled?: boolean
  errors?: string[]
  /** Relation pickers from the route; each falls back to the select beside it. */
  controls?: { uom?: JSXChild; category?: JSXChild }
}

/** A stable product code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'product_backend', group, value)

export const newProductScreen = (
  _: Translator,
  options: ProductCreateOptions,
  frame: Frame,
  locale = '',
): TemplateResult => {
  const formId = 'product-create-form'
  const badges: JSXChild[] = [
    <RecordToggle name="saleOk" label={_('product_backend.field.saleOk')} checked={true} form={formId} />,
    <RecordToggle
      name="purchaseOk"
      label={_('product_backend.field.purchaseOk')}
      checked={true}
      form={formId}
    />,
    ...(options.stockEnabled
      ? [
          <RecordToggle
            name="isStorable"
            label={_('product_backend.field.isStorable')}
            checked={true}
            form={formId}
          />,
        ]
      : []),
  ]

  const form: JSXChild = (
    <RecordForm
      id={formId}
      scope="product-create"
      action={localized('/admin/product/templates/new', locale)}
      submit={_('product_backend.action.create')}
      submitVariant="primary"
      cancelHref={localized('/admin/product/templates', locale)}
      cancelLabel={_('product_backend.action.cancel')}
      errors={options.errors}
      fields={[
        {
          name: 'type',
          label: _('product_backend.field.productKind'),
          type: 'radio',
          value: 'goods',
          required: true,
          span: 'full',
          options: ['goods', 'service'].map((value) => ({
            value,
            label: selectionLabel(_, 'type', value),
          })),
        },
        { name: 'name', label: _('product_backend.field.name'), required: true },
        {
          name: 'uomId',
          label: _('product_backend.field.uom'),
          type: 'select',
          // The field is optional on the model, so it gets the same empty option
          // the category beside it and the detail screen both offer. Without one
          // the browser preselects the first unit and every product is born with
          // a unit nobody chose.
          options: [{ value: '', label: '—' }, ...options.uoms],
          ...(options.controls?.uom ? { control: options.controls.uom } : {}),
        },
        {
          name: 'categoryId',
          label: _('product_backend.field.category'),
          type: 'select',
          options: [{ value: '', label: '—' }, ...options.categories],
          ...(options.controls?.category ? { control: options.controls.category } : {}),
        },
        {
          name: 'listPrice',
          label: _('product_backend.field.listPrice'),
          type: 'decimal',
          value: 0,
        },
        ...(options.stockEnabled
          ? [
              {
                name: 'tracking',
                label: _('product_backend.field.tracking'),
                type: 'select' as const,
                value: 'none',
                options: ['none', 'lot', 'serial'].map((value) => ({
                  value,
                  label: selectionLabel(_, 'tracking', value),
                })),
              },
            ]
          : []),
        {
          name: 'description',
          label: _('product_backend.field.description'),
          type: 'textarea',
          span: 'full',
        },
      ]}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('product_backend.create.title')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('product_backend.create.kicker')}
          title={_('product_backend.create.title')}
          subtitle={_('product_backend.create.subtitle')}
          imageFallback={icon('package')}
          badges={badges}
          body={form}
        />
      }
    />
  )
}
