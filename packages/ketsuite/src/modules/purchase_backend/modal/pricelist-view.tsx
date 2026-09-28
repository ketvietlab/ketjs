import { Button, DescriptionList } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Row = Record<string, unknown>
type Data = { record: Row; save: boolean; draftId: string; choices: Record<string, Row[]> }
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const fields: {
  name: string
  label: string
  type?: FieldProps['type']
  lookup?: string
  required?: boolean
  fallback?: string
}[] = [
  { name: 'partnerId', label: 'vendor', lookup: 'partners', required: true },
  { name: 'productTemplateId', label: 'template', lookup: 'templates', required: true },
  { name: 'productId', label: 'variant', lookup: 'variants' },
  { name: 'productUomId', label: 'uom', lookup: 'units', required: true },
  { name: 'minQty', label: 'minQty', type: 'decimal', fallback: '0' },
  { name: 'price', label: 'priceUnit', type: 'decimal', required: true, fallback: '0' },
  { name: 'discount', label: 'discount', type: 'decimal', fallback: '0' },
  { name: 'delay', label: 'delay', type: 'number', fallback: '1' },
  { name: 'sequence', label: 'sequence', type: 'number', fallback: '1' },
  { name: 'productCode', label: 'productCode' },
  { name: 'productName', label: 'productName' },
  { name: 'dateStart', label: 'dateStart', type: 'date' },
  { name: 'dateEnd', label: 'dateEnd', type: 'date' },
]
const values = (c: Context): FieldProps[] =>
  fields.map((field) => ({
    id: `supplier-${field.name}`,
    name: field.name,
    label: c.t(`purchase_backend.field.${field.label}`),
    type: field.lookup ? 'select' : field.type,
    required: field.required,
    disabled: c.busy,
    value: c.draft(
      field.name,
      String(c.data.record[field.name] ?? field.fallback ?? '').slice(
        0,
        field.type === 'date' ? 10 : undefined,
      ),
    ),
    error: c.fieldError(field.name),
    ...(field.lookup
      ? {
          options: [
            { value: '', label: '—' },
            ...(c.data.choices[field.lookup] ?? []).map((row) => ({
              value: String(row.id),
              label: String(row.name),
            })),
          ],
        }
      : {}),
  }))
export const vendorPricelistDefinition: RecordModalDefinition<Data> = {
  kind: 'purchase.vendorPrice',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) =>
      `/admin/purchase/vendor-price/${creating ? 'new' : encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) =>
    c.t(c.creating ? 'purchase_backend.action.addVendorPrice' : 'purchase_backend.pricelists.title'),
  body: (c) =>
    c.data.save ? (
      <RecordModalForm
        kind={c.kind}
        command="save"
        fields={values(c)}
        actions={[
          <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />,
        ]}
      />
    ) : (
      <DescriptionList
        items={values(c).map((field) => ({
          id: field.name!,
          label: field.label!,
          value:
            field.options?.find((option) => option.value === field.value)?.label ??
            String(field.value || '—'),
        }))}
      />
    ),
  commands: {
    save: {
      fn: 'purchase.saveSupplierInfo',
      input: (form, c) => ({
        id: c.creating ? c.data.draftId : c.id,
        ...Object.fromEntries(
          fields.map((field) => {
            const raw = String(form.get(field.name) ?? '')
            return [field.name, field.type === 'number' ? (raw ? Number(raw) : 0) : raw || null]
          }),
        ),
      }),
      after: 'close',
    },
  },
}
export const vendorPricelistModal = createRecordModal(vendorPricelistDefinition)
