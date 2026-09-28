import { Button, DescriptionList } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Row = Record<string, unknown>
type Data = { record: Row; rows: Row[]; save: boolean }
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const invoicingPolicyDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.invoicePolicy',
  size: 'default',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) =>
      `/admin/sales/invoice-policy/${creating ? 'new' : encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? c.t('sale_backend.action.savePolicy') : String(c.data.record.name)),
  body: (c) =>
    c.data.save ? (
      <RecordModalForm
        kind={c.kind}
        command="save"
        fields={[
          ...(c.creating
            ? [
                {
                  id: 'policy-product',
                  name: 'templateId',
                  label: c.t('sale_backend.field.product'),
                  type: 'select' as const,
                  required: true,
                  value: c.draft('templateId'),
                  options: c.data.rows.map((row) => ({ value: String(row.id), label: String(row.name) })),
                  error: c.fieldError('templateId'),
                  disabled: c.busy,
                },
              ]
            : []),
          {
            id: 'policy-value',
            name: 'invoicePolicy',
            label: c.t('sale_backend.field.invoicePolicy'),
            type: 'radio',
            required: true,
            value: c.draft('invoicePolicy', String(c.data.record.invoicePolicy ?? 'order')),
            options: ['order', 'delivery'].map((value) => ({
              value,
              label: c.t(`sale_backend.invoicePolicy.${value}`),
            })),
            error: c.fieldError('invoicePolicy'),
            disabled: c.busy,
          },
        ]}
        actions={[
          <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />,
        ]}
      />
    ) : (
      <DescriptionList
        items={[
          {
            id: 'policy',
            label: c.t('sale_backend.field.invoicePolicy'),
            value: c.t(`sale_backend.invoicePolicy.${c.data.record.invoicePolicy ?? 'order'}`),
          },
        ]}
      />
    ),
  commands: {
    save: {
      fn: 'sale.setInvoicePolicy',
      input: (form, c) => ({
        templateId: c.creating ? String(form.get('templateId') ?? '') : c.id,
        invoicePolicy: String(form.get('invoicePolicy') ?? ''),
      }),
      after: 'close',
    },
  },
}
export const invoicingPolicyModal = createRecordModal(invoicingPolicyDefinition)
