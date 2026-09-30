import type { FieldProps } from '@ketvietlab/design-system'
import { Button, DescriptionList, Notice, Stack } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Row = Record<string, unknown>
type Data = { record: Row; save: boolean; draftId: string; products: Row[]; locations: Row[]; lots: Row[] }
type Preview = { onHand: string; reserved: string; difference: string; unit: string; input: Row }
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
export const inventoryCountDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.count',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/count/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => c.t('stock_backend.adjustment.title'),
  body: (c) => {
    const preview = c.outcome<Preview>('preview')
    const t = (key: string) => c.t(`stock_backend.${key}`)
    const options = (rows: Row[]) => [
      { value: '', label: '—' },
      ...rows.map((row) => ({ value: String(row.id), label: String(row.name) })),
    ]
    if (!c.data.save)
      return (
        <DescriptionList
          items={['quantity', 'reservedQuantity'].map((key) => ({
            id: key,
            label: t(key === 'quantity' ? 'inventory.col.onHand' : 'inventory.col.reserved'),
            value: String(c.data.record[key] ?? '0'),
          }))}
        />
      )
    return (
      <RecordModalForm
        kind={c.kind}
        fields={(
          [
            {
              id: 'count-product',
              name: 'productId',
              label: t('field.product'),
              type: 'select',
              options: options(c.data.products),
              value: c.draft('productId', String(c.data.record.productId ?? '')),
              required: true,
              error: c.fieldError('productId'),
            },
            {
              id: 'count-location',
              name: 'locationId',
              label: t('field.location'),
              type: 'select',
              options: options(
                c.data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
              ),
              value: c.draft('locationId', String(c.data.record.locationId ?? '')),
              required: true,
              error: c.fieldError('locationId'),
            },
            {
              id: 'count-lot',
              name: 'lotId',
              label: t('field.lot'),
              type: 'select',
              options: options(c.data.lots),
              value: c.draft('lotId', String(c.data.record.lotId ?? '')),
              error: c.fieldError('lotId'),
            },
            {
              id: 'count-quantity',
              name: 'countedQuantity',
              label: t('field.counted'),
              type: 'decimal',
              value: c.draft('countedQuantity', ''),
              required: true,
              help: t('count.unitHint'),
              error: c.fieldError('countedQuantity'),
            },
            {
              id: 'count-inventory',
              name: 'inventoryLocationId',
              label: t('field.inventoryLocation'),
              type: 'select',
              options: options(c.data.locations.filter((row) => row.usage === 'inventory')),
              value: c.draft('inventoryLocationId', ''),
              required: true,
              error: c.fieldError('inventoryLocationId'),
            },
            {
              id: 'count-reason',
              name: 'reason',
              label: t('count.reason'),
              type: 'textarea',
              value: c.draft('reason', ''),
              error: c.fieldError('reason'),
            },
          ] satisfies FieldProps[]
        ).map((field) => ({ ...field, disabled: c.busy }))}
        body={
          preview ? (
            <Stack
              items={[
                <Notice tone="info" title={t('count.previewTitle')} message={t('count.previewHint')} />,
                <DescriptionList
                  items={[
                    {
                      id: 'before',
                      label: t('inventory.col.onHand'),
                      value: `${preview.onHand} ${preview.unit}`,
                    },
                    {
                      id: 'difference',
                      label: t('count.difference'),
                      value: `${preview.difference} ${preview.unit}`,
                    },
                    {
                      id: 'reserved',
                      label: t('inventory.col.reserved'),
                      value: `${preview.reserved} ${preview.unit}`,
                    },
                  ]}
                />,
              ]}
            />
          ) : null
        }
        actions={[
          <Button
            type="submit"
            name="__command"
            value="preview"
            label={t('count.preview')}
            disabled={c.busy}
          />,
          ...(preview
            ? [
                <Button
                  type="submit"
                  name="__command"
                  value="apply"
                  label={t('action.apply')}
                  variant="primary"
                  disabled={c.busy}
                />,
              ]
            : []),
        ]}
      />
    )
  },
  commands: {
    preview: {
      fn: 'stock.previewInventoryCount',
      preview: true,
      input: (form) => ({
        productId: String(form.get('productId') ?? ''),
        locationId: String(form.get('locationId') ?? ''),
        countedQuantity: String(form.get('countedQuantity') ?? ''),
        ...(form.get('lotId') ? { lotId: String(form.get('lotId')) } : {}),
      }),
    },
    apply: {
      fn: 'stock.adjustInventory',
      after: 'close',
      input: (form, c) => ({
        id: c.data.draftId,
        ...c.outcome<Preview>('preview')?.input,
        inventoryLocationId: String(form.get('inventoryLocationId') ?? ''),
        reason: String(form.get('reason') ?? ''),
      }),
    },
  },
}
export const inventoryCountModal = createRecordModal(inventoryCountDefinition)
