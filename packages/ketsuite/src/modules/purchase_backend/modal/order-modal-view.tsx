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
export type PurchaseOrderModalData = {
  record: Row & { lines: Row[]; pickings: Row[]; moves?: Row[]; bills: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
  lang: 'vi' | 'en'
  draftId: string
}
type Context = RecordModalContext<PurchaseOrderModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`purchase_backend.${key}`)
const canEdit = (c: Context) =>
  ['draft', 'sent', 'to approve'].includes(String(c.data.record.state)) && !c.data.record.locked
const options = (c: Context, name: string) =>
  (c.data.choices[name] ?? []).map((row) => ({ value: String(row.id), label: String(row.name) }))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `purchase-${c.dialog?.name ?? 'record'}-${name}`,
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
    field(c, 'productQty', 'productQty', {
      type: 'decimal',
      value: String(row?.productQty ?? '1'),
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
      field(c, 'partnerId', 'vendor', { type: 'select', options: options(c, 'partners'), required: true }),
      field(c, 'pickingTypeId', 'pickingType', {
        type: 'select',
        options: options(c, 'pickingTypes'),
        required: true,
      }),
      field(c, 'partnerRef', 'partnerRef'),
      field(c, 'dateOrder', 'dateOrder', { type: 'date' }),
      field(c, 'datePlanned', 'datePlanned', { type: 'date' }),
      field(c, 'notes', 'notes', { type: 'textarea', span: 'full' }),
    ]}
    actions={[<Button type="submit" label={t(c, 'action.createRfq')} variant="primary" disabled={c.busy} />]}
  />
)
const summary = (c: Context) => (
  <Stack
    items={[
      <DescriptionList
        items={['partnerName', 'partnerRef', 'dateOrder', 'datePlanned', 'amountTotal', 'notes'].map(
          (key) => ({
            id: key,
            label: t(c, `field.${key === 'partnerName' ? 'vendor' : key}`),
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
              { key: 'productQty', label: t(c, 'field.productQty'), cell: (row) => String(row.productQty) },
              {
                key: 'qtyReceived',
                label: t(c, 'field.qtyReceived'),
                cell: (row) => String(row.qtyReceived),
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
export const purchaseOrderModalDefinition: RecordModalDefinition<PurchaseOrderModalData> = {
  kind: 'purchase.order',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) =>
      `/admin/purchase/record/${creating ? 'new' : encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'action.createRfq') : String(c.data.record.name)),
  status: (c) => (c.creating ? null : <Badge label={t(c, `state.${c.data.record.state}`)} />),
  body: (c) => (c.creating ? create(c) : summary(c)),
  tabs: [
    { id: 'info', label: (c) => t(c, 'modal.info'), visible: (c) => !c.creating, view: summary },
    {
      id: 'receipts',
      label: (c) => t(c, 'modal.receipts'),
      visible: (c) => !c.creating,
      view: (c) => (
        <DataTable
          rows={c.data.record.pickings}
          id={(row) => String(row.id)}
          responsive="scroll"
          columns={[
            { key: 'name', label: t(c, 'field.name'), cell: (row) => String(row.name) },
            { key: 'state', label: t(c, 'field.state'), cell: (row) => String(row.state) },
            {
              key: 'receive',
              label: t(c, 'modal.receive'),
              cell: (row) =>
                row.state !== 'done' && row.state !== 'cancel' && c.data.permissions.receiveOrderReceipt ? (
                  <RecordActionForm kind={c.kind} command="receive" hidden={{ receiptId: String(row.id) }}>
                    <Button type="submit" label={t(c, 'modal.receive')} />
                  </RecordActionForm>
                ) : (
                  ''
                ),
            },
          ]}
        />
      ),
    },
    {
      id: 'bills',
      label: (c) => t(c, 'modal.bills'),
      visible: (c) => !c.creating,
      view: (c) => (
        <Section
          title={t(c, 'modal.bills')}
          actions={
            c.data.record.state === 'purchase' && c.data.permissions.createVendorBill
              ? dialog(c, 'bill', 'createBill')
              : null
          }
          body={
            <DataTable
              rows={c.data.record.bills}
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
      visible: (c) => !c.creating,
      view: (c) => (
        <Stack
          items={[
            ...(['sent', 'to approve'].includes(String(c.data.record.state)) &&
            c.data.permissions.resetToDraft
              ? [action(c, 'reset', 'resetToDraft')]
              : []),
            ...(c.data.record.state === 'purchase' && c.data.permissions.lockOrder
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
    c.creating ? undefined : (
      <ActionGroup
        actions={[
          ...(c.data.record.state === 'draft' && c.data.permissions.sendRfq
            ? [action(c, 'send', 'send')]
            : []),
          ...(['draft', 'sent'].includes(String(c.data.record.state)) && c.data.permissions.confirmOrder
            ? [action(c, 'confirm', 'confirm', true), action(c, 'requestApproval', 'requestApproval')]
            : []),
          ...(c.data.record.state === 'to approve' && c.data.permissions.approveOrder
            ? [action(c, 'approve', 'approve', true)]
            : []),
          ...(c.data.record.state === 'purchase' && c.data.permissions.syncReceipts
            ? [action(c, 'sync', 'syncReceipts')]
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
      title: (c) => t(c, 'action.createBill'),
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
            ...(['expenseAccountId', 'payableAccountId', 'taxAccountId'] as const).map((name) =>
              field(c, name, name.replace('Id', ''), {
                type: 'select',
                options: options(c, 'accounts'),
                required: name !== 'taxAccountId',
              }),
            ),
            field(c, 'invoiceDate', 'invoiceDate', { type: 'date' }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.createBill')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    create: {
      fn: 'purchase.createOrder',
      input: (form, c) => ({
        id: c.data.draftId,
        ...input(form, ['partnerId', 'pickingTypeId', 'partnerRef', 'dateOrder', 'datePlanned', 'notes']),
      }),
      after: 'open',
    },
    addLine: {
      fn: 'purchase.addLine',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, ['productId', 'productUomId', 'productQty', 'priceUnit', 'discount', 'taxId']),
      }),
      after: 'reload',
    },
    updateLine: {
      fn: 'purchase.updateLine',
      input: (form, c) => ({
        id: c.dialog?.params.id,
        ...input(form, ['productQty', 'priceUnit', 'discount', 'taxId']),
      }),
      after: 'reload',
    },
    removeLine: {
      fn: 'purchase.removeLine',
      input: (_form, c) => ({ id: c.dialog?.params.id }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmRemove'),
    },
    send: { fn: 'purchase.sendRfq', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    confirm: {
      fn: 'purchase.confirmOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
    },
    requestApproval: {
      fn: 'purchase.confirmOrder',
      input: (_form, c) => ({
        id: c.id,
        requiresApproval: true,
        expectedRevision: Number(c.data.record.revision),
      }),
      after: 'reload',
    },
    approve: {
      fn: 'purchase.approveOrder',
      input: (_form, c) => ({ id: c.id, expectedRevision: Number(c.data.record.revision) }),
      after: 'reload',
    },
    reset: { fn: 'purchase.resetToDraft', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    sync: { fn: 'purchase.syncReceipts', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    receive: {
      fn: 'purchase.receiveOrderReceipt',
      input: (form, c) => ({
        id: c.id,
        receiptId: String(form.get('receiptId')),
        expectedRevision: Number(c.data.record.revision),
      }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmReceive'),
    },
    lock: { fn: 'purchase.lockOrder', input: (_form, c) => ({ id: c.id, locked: true }), after: 'reload' },
    unlock: { fn: 'purchase.lockOrder', input: (_form, c) => ({ id: c.id, locked: false }), after: 'reload' },
    cancel: {
      fn: 'purchase.cancelOrder',
      input: (_form, c) => ({ id: c.id }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmCancel'),
    },
    bill: {
      fn: 'purchase.createVendorBill',
      input: (form, c) => ({
        id: c.data.draftId,
        orderId: c.id,
        ...input(form, ['journalId', 'expenseAccountId', 'payableAccountId', 'taxAccountId', 'invoiceDate']),
      }),
      after: 'reload',
    },
  },
}
export const purchaseOrderModal = createRecordModal(purchaseOrderModalDefinition)
