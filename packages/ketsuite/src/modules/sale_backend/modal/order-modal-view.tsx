import {
  ActionGroup,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

type Row = Record<string, unknown>
export type SaleOrderModalData = {
  record: Row & { lines: Row[]; pickings: Row[]; moves?: Row[]; invoices: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
  lang: 'vi' | 'en'
  draftId: string
}
type Context = RecordModalContext<SaleOrderModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`sale_backend.${key}`)
const locallyOwned = (c: Context) => !c.data.record.orderAuthority || c.data.record.orderAuthority === 'local'
const canEdit = (c: Context) =>
  locallyOwned(c) && ['draft', 'sent'].includes(String(c.data.record.state)) && !c.data.record.locked
const options = (c: Context, name: string) =>
  (c.data.choices[name] ?? []).map((row) => ({ value: String(row.id), label: String(row.name) }))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `sale-${c.dialog?.name ?? 'record'}-${name}`,
  name,
  label: t(c, `field.${label}`),
  ...props,
  value: c.draft(name, String(props.value ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
})
const action = (c: Context, command: string, label: string, primary = false) => (
  <RecordActionForm kind={c.kind} command={command}>
    <Button
      type="submit"
      label={t(c, `action.${label}`)}
      variant={primary ? 'primary' : 'secondary'}
      disabled={c.busy}
    />
  </RecordActionForm>
)
const dialog = (c: Context, name: string, label: string) => (
  <RecordDialogTrigger dialog={name}>
    <Button label={t(c, `action.${label}`)} disabled={c.busy} />
  </RecordDialogTrigger>
)
const input = (form: FormData, keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = String(form.get(key) ?? '')
      return value ? [[key, value]] : []
    }),
  )
const line = (c: Context) => c.data.record.lines.find((row) => row.id === c.dialog?.params.id)
const lineFields = (c: Context, editing = false): FieldProps[] => {
  const row = editing ? line(c) : undefined
  return [
    ...(!editing
      ? [
          field(c, 'productId', 'product', {
            type: 'select',
            options: options(c, 'variants'),
            required: true,
          }),
          field(c, 'productUomId', 'uom', { type: 'select', options: options(c, 'units'), required: true }),
        ]
      : []),
    field(c, 'productUomQty', 'quantity', {
      type: 'decimal',
      value: String(row?.productUomQty ?? '1'),
      required: true,
    }),
    field(c, 'priceUnit', 'priceUnit', { type: 'decimal', value: String(row?.priceUnit ?? '') }),
    field(c, 'discount', 'discount', { type: 'decimal', value: String(row?.discount ?? '0') }),
    field(c, 'taxId', 'tax', {
      type: 'select',
      options: [{ value: '', label: '—' }, ...options(c, 'taxes')],
      value: String(row?.taxId ?? ''),
    }),
  ]
}
const create = (c: Context) => (
  <RecordModalForm
    kind={c.kind}
    command="create"
    fields={[
      field(c, 'partnerId', 'customer', { type: 'select', options: options(c, 'partners'), required: true }),
      field(c, 'warehouseId', 'warehouse', {
        type: 'select',
        options: options(c, 'warehouses'),
        required: true,
      }),
      field(c, 'clientOrderRef', 'clientOrderRef'),
      field(c, 'pricelistId', 'pricelist', {
        type: 'select',
        options: [{ value: '', label: '—' }, ...options(c, 'pricelists')],
      }),
      field(c, 'paymentTermId', 'paymentTerm', {
        type: 'select',
        options: [{ value: '', label: '—' }, ...options(c, 'terms')],
      }),
      field(c, 'dateOrder', 'dateOrder', { type: 'date' }),
      field(c, 'validityDate', 'validityDate', { type: 'date' }),
      field(c, 'notes', 'notes', { type: 'textarea', span: 'full' }),
    ]}
    actions={[<Button type="submit" label={t(c, 'action.create')} variant="primary" disabled={c.busy} />]}
  />
)
const summary = (c: Context) => (
  <Stack
    items={[
      <DescriptionList
        items={['partnerName', 'clientOrderRef', 'dateOrder', 'validityDate', 'amountTotal', 'notes'].map(
          (key) => ({
            id: key,
            label: t(c, `field.${key === 'partnerName' ? 'customer' : key}`),
            value:
              String((c.data.record.display as Row | undefined)?.[key] ?? c.data.record[key] ?? '—') || '—',
          }),
        )}
      />,
      <Section
        title={t(c, 'modal.lines')}
        actions={canEdit(c) && c.data.permissions.addLine ? dialog(c, 'addLine', 'addLine') : null}
        body={
          <DataTable
            rows={c.data.record.lines}
            id={(row) => String(row.id)}
            responsive="scroll"
            columns={[
              { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
              {
                key: 'productUomQty',
                label: t(c, 'field.quantity'),
                cell: (row) => String(row.productUomQty),
              },
              {
                key: 'qtyDelivered',
                label: t(c, 'field.delivered'),
                cell: (row) => String(row.qtyDelivered),
              },
              {
                key: 'priceUnit',
                label: t(c, 'field.priceUnit'),
                cell: (row) => String(row.priceUnitLabel ?? row.priceUnit),
              },
              {
                key: 'edit',
                label: t(c, 'modal.edit'),
                cell: (row) =>
                  canEdit(c) && c.data.permissions.updateLine ? (
                    <RecordDialogTrigger dialog="editLine" id={String(row.id)}>
                      <Button label={t(c, 'modal.edit')} variant="tertiary" />
                    </RecordDialogTrigger>
                  ) : (
                    ''
                  ),
              },
            ]}
          />
        }
      />,
    ]}
  />
)
export const saleOrderModalDefinition: RecordModalDefinition<SaleOrderModalData> = {
  kind: 'sale.order',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/sales/record/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'action.create') : String(c.data.record.name)),
  status: (c) => (c.creating ? null : <Badge label={t(c, `state.${c.data.record.state}`)} />),
  body: (c) => (c.creating ? create(c) : summary(c)),
  tabs: [
    { id: 'info', label: (c) => t(c, 'modal.info'), visible: (c) => !c.creating, view: summary },
    {
      id: 'deliveries',
      label: (c) => t(c, 'modal.deliveries'),
      visible: (c) => !c.creating,
      view: (c) => (
        <DataTable
          rows={c.data.record.pickings}
          id={(row) => String(row.id)}
          responsive="scroll"
          columns={[
            { key: 'name', label: t(c, 'field.name'), cell: (row) => String(row.name) },
            { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
          ]}
        />
      ),
    },
    {
      id: 'invoices',
      label: (c) => t(c, 'modal.invoices'),
      visible: (c) => !c.creating,
      view: (c) => (
        <Section
          title={t(c, 'modal.invoices')}
          actions={
            locallyOwned(c) && c.data.record.state === 'sale' && c.data.permissions.createInvoice
              ? dialog(c, 'bill', 'createInvoice')
              : null
          }
          body={
            <DataTable
              rows={c.data.record.invoices}
              id={(row) => String(row.id)}
              responsive="scroll"
              columns={[
                { key: 'name', label: t(c, 'field.name'), cell: (row) => String(row.name) },
                { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
              ]}
            />
          }
        />
      ),
    },
    {
      id: 'actions',
      label: (c) => t(c, 'modal.more'),
      visible: (c) => !c.creating && locallyOwned(c),
      view: (c) => (
        <Stack
          items={[
            ...(c.data.record.state === 'cancel' && c.data.permissions.resetOrder
              ? [action(c, 'reset', 'reset')]
              : []),
            ...(c.data.record.state === 'sale' && c.data.permissions.lockOrder
              ? [
                  action(
                    c,
                    c.data.record.locked ? 'unlock' : 'lock',
                    c.data.record.locked ? 'unlock' : 'lock',
                  ),
                ]
              : []),
            ...(c.data.record.state !== 'cancel' &&
            !c.data.record.locked &&
            !c.data.record.moves?.some((row) => row.state === 'done') &&
            c.data.permissions.cancelOrder
              ? [action(c, 'cancel', 'cancel')]
              : []),
          ]}
        />
      ),
    },
  ],
  actions: (c) =>
    c.creating || !locallyOwned(c) ? undefined : (
      <ActionGroup
        actions={[
          ...(c.data.record.state === 'draft' && c.data.permissions.sendQuotation
            ? [action(c, 'send', 'send')]
            : []),
          ...(['draft', 'sent'].includes(String(c.data.record.state)) && c.data.permissions.confirmOrder
            ? [action(c, 'confirm', 'confirm', true)]
            : []),
          ...(c.data.record.state === 'sale' && c.data.permissions.syncDeliveries
            ? [action(c, 'sync', 'sync')]
            : []),
        ]}
      />
    ),
  dialogs: {
    addLine: {
      title: (c) => t(c, 'action.addLine'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="addLine"
          fields={lineFields(c)}
          actions={[
            <Button type="submit" label={t(c, 'action.addLine')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
    editLine: {
      title: (c) => t(c, 'modal.edit'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          fields={lineFields(c, true)}
          actions={[
            <Button
              type="submit"
              name="__command"
              value="updateLine"
              label={t(c, 'action.updateLine')}
              variant="primary"
              disabled={c.busy}
            />,
            ...(c.data.permissions.removeLine
              ? [
                  <Button
                    type="submit"
                    name="__command"
                    value="removeLine"
                    label={t(c, 'action.removeLine')}
                    variant="destructive"
                    disabled={c.busy}
                  />,
                ]
              : []),
          ]}
        />
      ),
    },
    bill: {
      title: (c) => t(c, 'action.createInvoice'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="bill"
          fields={[
            field(c, 'journalId', 'journal', {
              type: 'select',
              options: options(c, 'journals'),
              required: true,
            }),
            ...(['revenueAccountId', 'receivableAccountId', 'taxAccountId'] as const).map((name) =>
              field(c, name, name.replace('Id', ''), {
                type: 'select',
                options: options(c, 'accounts'),
                required: name !== 'taxAccountId',
              }),
            ),
            field(c, 'invoiceDate', 'invoiceDate', { type: 'date' }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.createInvoice')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    create: {
      fn: 'sale.createOrder',
      input: (form, c) => ({
        id: c.data.draftId,
        ...input(form, [
          'partnerId',
          'warehouseId',
          'pricelistId',
          'paymentTermId',
          'clientOrderRef',
          'dateOrder',
          'validityDate',
          'notes',
        ]),
      }),
      after: 'open',
    },
    addLine: {
      fn: 'sale.addLine',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, ['productId', 'productUomId', 'productUomQty', 'priceUnit', 'discount', 'taxId']),
      }),
      after: 'reload',
    },
    updateLine: {
      fn: 'sale.updateLine',
      input: (form, c) => ({
        id: c.dialog?.params.id,
        expectedRevision: Number(c.data.record.revision),
        ...input(form, ['productUomQty', 'priceUnit', 'discount']),
        ...(String(form.get('taxId') ?? '') !== String(line(c)?.taxId ?? '')
          ? { taxIds: form.get('taxId') ? [String(form.get('taxId'))] : [] }
          : {}),
      }),
      after: 'reload',
    },
    removeLine: {
      fn: 'sale.removeLine',
      input: (_form, c) => ({ id: c.dialog?.params.id }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmRemove'),
    },
    send: { fn: 'sale.sendQuotation', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    confirm: {
      fn: 'sale.confirmOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
    },
    reset: { fn: 'sale.resetOrder', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    sync: { fn: 'sale.syncDeliveries', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    lock: { fn: 'sale.lockOrder', input: (_form, c) => ({ id: c.id, locked: true }), after: 'reload' },
    unlock: { fn: 'sale.lockOrder', input: (_form, c) => ({ id: c.id, locked: false }), after: 'reload' },
    cancel: {
      fn: 'sale.cancelOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmCancel'),
    },
    bill: {
      fn: 'sale.createInvoice',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, [
          'journalId',
          'revenueAccountId',
          'receivableAccountId',
          'taxAccountId',
          'invoiceDate',
        ]),
      }),
      after: 'reload',
    },
  },
}
export const saleOrderModal = createRecordModal(saleOrderModalDefinition)
