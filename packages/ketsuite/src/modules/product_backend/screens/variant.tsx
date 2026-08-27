import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  MediaPanel,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormOption, Frame, MediaPanelProps } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import { selectionLabel as resolveSelection } from '../../backend/screen.ts'

const mediaLabels = (_: Translator) => ({
  unavailable: _('product_backend.media.unavailable'),
  empty: _('product_backend.media.empty'),
  loading: _('product_backend.media.loading'),
  loadError: _('product_backend.media.error'),
  retryHint: _('product_backend.media.retry'),
  primary: _('product_backend.media.primaryLabel'),
  makePrimary: _('product_backend.media.primary'),
  moveUp: _('product_backend.media.up'),
  moveDown: _('product_backend.media.down'),
  remove: _('product_backend.media.remove'),
  choose: _('product_backend.media.choose'),
  add: _('product_backend.media.add'),
})

/** A stable product code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'product_backend', group, value)

export const VARIANT_DETAIL_TABS = ['general', 'media'] as const
export type VariantDetailTab = (typeof VARIANT_DETAIL_TABS)[number]

export const variantScreen = (
  _: Translator,
  templateId: string,
  row: Record<string, unknown>,
  media: MediaPanelProps,
  uoms: FormOption[],
  template: { name: string },
  collaboration: JSXChild,
  frame: Frame,
  errors?: string[],
  locale = '',
  editor?: JSXChild,
  activeTab: VariantDetailTab = 'general',
  partial = false,
  uomControl?: JSXChild,
): TemplateResult => {
  const images = media.images ?? []
  const productUom = Array.isArray(row.uoms)
    ? (row.uoms[0] as Record<string, unknown> | undefined)
    : undefined
  const tabHref = (tab: VariantDetailTab) =>
    localized(`/admin/product/templates/${templateId}/variants/${String(row.id)}?tab=${tab}`, locale)
  // The heading names the variant, not its template: arriving from the variant
  // list on a page headed with the template's name gives the reader no way to
  // tell which of the two screens they are on.
  const values = Array.isArray(row.values) ? (row.values as Array<Record<string, unknown>>) : []
  const title = String(row.name || row.defaultCode || row.id)
  const subtitle = [
    `${_('product_backend.variant.template')}: ${template.name}`,
    // The combination as attribute and value, not as the key the database stores
    // it under: "Màu sắc: Đỏ" rather than "color-red".
    ...values.map((entry) =>
      entry.attribute ? `${String(entry.attribute)}: ${String(entry.value)}` : String(entry.value),
    ),
  ]
    .filter(Boolean)
    .join(' · ')
  const general = (
    <RecordForm
      id="product-variant-form"
      action={tabHref('general')}
      submit={_('product_backend.action.save')}
      submitVariant="primary"
      submitPlacement="external"
      scope="product-variant"
      errors={errors}
      fields={[
        {
          name: 'defaultCode',
          label: _('product_backend.field.defaultCode'),
          value: String(row.defaultCode ?? ''),
        },
        { name: 'barcode', label: _('product_backend.field.barcode'), value: String(row.barcode ?? '') },
        {
          name: 'weight',
          label: _('product_backend.field.weight'),
          type: 'decimal',
          value: Number(row.weight ?? 0),
        },
        {
          name: 'volume',
          label: _('product_backend.field.volume'),
          type: 'decimal',
          value: Number(row.volume ?? 0),
        },
        {
          name: 'standardPrice',
          label: _('product_backend.field.standardPrice'),
          type: 'decimal',
          value: Number((row.cost as Record<string, unknown> | null)?.standardPrice ?? 0),
        },
        {
          name: 'uomId',
          label: _('product_backend.field.uom'),
          type: 'select',
          value: productUom?.uomId ? String(productUom.uomId) : '',
          options: [{ value: '', label: '—' }, ...uoms],
          ...(uomControl ? { control: uomControl } : {}),
        },
        {
          name: 'uomBarcode',
          label: _('product_backend.field.uomBarcode'),
          value: String(productUom?.barcode ?? ''),
        },
      ]}
    />
  )
  const mediaTab = (
    <Section
      title={_('product_backend.media.title')}
      description={_('product_backend.media.description')}
      body={<MediaPanel {...media} labels={mediaLabels(_)} />}
    />
  )
  const generalTab = stack([
    <Section title={_('product_backend.tabs.general')} body={<Surface body={general} />} />,
  ])
  const archived = row.active === false
  const page = (
    <FormPage
      scope="product-variant-form-page"
      title={title}
      description={subtitle}
      status={badge(
        selectionLabel(_, 'state', archived ? 'archived' : 'active'),
        archived ? 'neutral' : 'positive',
        archived ? 'archived' : 'active',
      )}
      actions={
        activeTab === 'general' ? (
          <FormCluster
            label={_('product_backend.action.actions')}
            forms={[
              button({
                label: _('product_backend.action.save'),
                type: 'submit',
                form: 'product-variant-form',
                variant: 'primary',
              }),
            ]}
          />
        ) : undefined
      }
      navigation={
        <Tabs
          label={_('product_backend.variant.tabs.label')}
          items={[
            {
              id: 'general',
              label: _('product_backend.tabs.general'),
              href: tabHref('general'),
              active: activeTab === 'general',
            },
            {
              id: 'media',
              label: _('product_backend.tabs.media'),
              href: tabHref('media'),
              active: activeTab === 'media',
              count: images.length,
            },
          ]}
        />
      }
      controller={editor}
      body={activeTab === 'media' ? mediaTab : generalTab}
      aside={collaboration}
      asideLabel={_('product_backend.variant.collaboration.label')}
      slots={{
        header: 'product.record-header',
        body: 'product.record-body',
        ...(partial ? { fragmentTitle: title } : {}),
      }}
    />
  )
  return partial ? page : shell(_, title, page, { ...frame, topbar: false, titled: false })
}
