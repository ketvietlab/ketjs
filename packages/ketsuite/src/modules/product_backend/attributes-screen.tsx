import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  CardGrid,
  ContentCard,
  emptyState,
  Framed,
  icon,
  inline,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'
import { selectionLabel as resolveSelection } from '../backend/screen.ts'

type AttributeRow = Record<string, unknown>

/** A stable product code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'product_backend', group, value)

const ValueBadges = ({
  _,
  values,
}: {
  _: Translator
  values: Array<Record<string, unknown>>
}): TemplateResult =>
  inline([
    values.length
      ? each(
          values,
          (value) => value.id,
          (value) => badge(String(value.name)),
        )
      : badge(_('product_backend.attributes.noValues')),
  ])

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
  const body: JSXChild = stack(
    [
      <ValueBadges _={_} values={values} />,
      <RecordForm
        scope="product-attribute-value"
        action={localized(`/admin/product/attributes/${String(row.id)}/values`, locale)}
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
      />,
    ],
    'compact',
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
      action={localized('/admin/product/attributes', locale)}
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

  return (
    <Framed
      translator={_}
      title={_('product_backend.attributes.title')}
      frame={frame}
      body={stack(
        [
          <Section
            title={_('product_backend.attributes.createTitle')}
            description={_('product_backend.attributes.createHint')}
            body={<Surface padding="compact" body={createForm} />}
          />,
          <Section
            title={_('product_backend.attributes.configuredTitle')}
            description={_('product_backend.attributes.configuredHint')}
            body={configured}
          />,
        ],
        'loose',
      )}
    />
  )
}
