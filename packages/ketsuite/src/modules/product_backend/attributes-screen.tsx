import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  cardGrid as CardGrid,
  contentCard as ContentCard,
  emptyState,
  framed,
  icon,
  recordForm as RecordForm,
  section as Section,
  surface as Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

type AttributeRow = Record<string, unknown>

const localized = (path: string, locale: string): string => {
  if (!locale) return path
  const target = new URL(path, 'http://ket.local')
  const lang = new URLSearchParams(locale.replace(/^\?/, '')).get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

const selectionLabel = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value)
  const key = `product_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

const ValueBadges = ({
  _,
  values,
}: {
  _: Translator
  values: Array<Record<string, unknown>>
}): TemplateResult => (
  <div data-ui="inline">
    {values.length
      ? each(
          values,
          (value) => value.id,
          (value) => badge(String(value.name)),
        )
      : badge(_('product_backend.attributes.noValues'))}
  </div>
)

const AttributeCard = ({
  _,
  row,
  locale,
}: {
  _: Translator
  row: AttributeRow
  locale: string
}): TemplateResult => {
  const values = Array.isArray(row.values) ? (row.values as Array<Record<string, unknown>>) : []
  const body: JSXChild = (
    <div data-ui="stack" data-gap="compact">
      <ValueBadges _={_} values={values} />
      <RecordForm
        scope="product-attribute-value"
        action={localized(`/admin/product-attributes/${String(row.id)}/values`, locale)}
        submit={_('product_backend.action.add')}
        submitVariant="secondary"
        fields={[
          {
            name: 'name',
            label: _('product_backend.attributes.valueName'),
            required: true,
            span: 'full',
          },
          {
            name: 'sequence',
            label: _('product_backend.col.sequence'),
            type: 'number',
            value: 10,
            span: 'full',
          },
        ]}
      />
    </div>
  )
  return (
    <ContentCard
      title={String(row.name)}
      summary={`${selectionLabel(_, 'displayType', row.displayType)} · ${selectionLabel(_, 'createVariant', row.createVariant)}`}
      body={body}
    />
  )
}

export const attributesScreen = (
  _: Translator,
  rows: AttributeRow[],
  frame: Frame,
  errors?: string[],
  locale = '',
): TemplateResult => {
  const createForm: JSXChild = (
    <RecordForm
      id="product-attribute-create"
      scope="product-attribute-create"
      action={localized('/admin/product-attributes', locale)}
      submit={_('product_backend.action.create')}
      submitVariant="primary"
      errors={errors}
      fields={[
        { name: 'name', label: _('product_backend.field.name'), required: true },
        { name: 'sequence', label: _('product_backend.col.sequence'), type: 'number', value: 10 },
        {
          name: 'displayType',
          label: _('product_backend.attributes.displayType'),
          type: 'select',
          options: ['radio', 'pills', 'select', 'color', 'multi'].map((value) => ({
            value,
            label: selectionLabel(_, 'displayType', value),
          })),
        },
        {
          name: 'createVariant',
          label: _('product_backend.attributes.createVariant'),
          type: 'select',
          options: [
            { value: 'always', label: _('product_backend.attributes.always') },
            { value: 'no_variant', label: _('product_backend.attributes.never') },
          ],
        },
      ]}
    />
  )
  const configured: JSXChild = rows.length ? (
    <CardGrid
      items={rows}
      id={(row) => row.id}
      card={(row) => <AttributeCard _={_} row={row} locale={locale} />}
    />
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('product_backend.attributes.empty'), _('product_backend.attributes.emptyHint'), {
        icon: icon('sliders-horizontal'),
      })}
    />
  )

  return framed(
    _,
    _('product_backend.attributes.title'),
    frame,
    <div data-ui="stack" data-gap="loose">
      <Section
        title={_('product_backend.attributes.createTitle')}
        description={_('product_backend.attributes.createHint')}
        body={<Surface padding="compact" body={createForm} />}
      />
      <Section
        title={_('product_backend.attributes.configuredTitle')}
        description={_('product_backend.attributes.configuredHint')}
        body={configured}
      />
    </div>,
  )
}
