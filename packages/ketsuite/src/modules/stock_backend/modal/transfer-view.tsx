import {
  ActionGroup,
  Badge,
  Button,
  LinkButton,
  DataTable,
  DescriptionList,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordModalForm,
  RecordDialogTrigger,
  RecordActionForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
type Row = Record<string, unknown>
type Data = {
  record: Row & { moves: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
  detailsHref?: string
  draftId: string
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
const open = (c: Context) => !['done', 'cancel'].includes(String(c.data.record.state))
const options = (c: Context, key: string) => [
  { value: '', label: '—' },
  ...(c.data.choices[key] ?? []).map((row) => ({ value: String(row.id), label: String(row.name) })),
]
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `transfer-${c.dialog?.name ?? 'record'}-${name}`,
  name,
  label: t(c, label),
  ...props,
  value: c.draft(name, String(props.value ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
})
const inputs = (form: FormData, keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = String(form.get(key) ?? '')
      return value ? [[key, value]] : []
    }),
  )
const editFields = (c: Context) => [
  field(c, 'name', 'transfer.list.col.reference', {
    required: true,
    value: String(c.data.record.name ?? ''),
  }),
  field(c, 'pickingTypeId', 'field.operationType', {
    type: 'select',
    options: options(c, 'pickingTypes'),
    required: true,
    value: String(c.data.record.pickingTypeId ?? ''),
  }),
  field(c, 'locationId', 'field.sourceLocation', {
    type: 'select',
    options: options(c, 'locations'),
    value: String(c.data.record.locationId ?? ''),
  }),
  field(c, 'locationDestId', 'field.destinationLocation', {
    type: 'select',
    options: options(c, 'locations'),
    value: String(c.data.record.locationDestId ?? ''),
  }),
  field(c, 'scheduledDate', 'transfer.list.col.scheduledDate', {
    type: 'date',
    value: String(c.data.record.scheduledDate ?? '').slice(0, 10),
  }),
]
const action = (c: Context, name: string, label: string) => (
  <RecordActionForm kind={c.kind} command={name}>
    <Button type="submit" label={t(c, `action.${label}`)} disabled={c.busy} />
  </RecordActionForm>
)
const dialog = (c: Context, name: string, label: string) => (
  <RecordDialogTrigger dialog={name}>
    <Button label={t(c, label)} disabled={c.busy} />
  </RecordDialogTrigger>
)
const selectedLine = (c: Context) =>
  c.data.record.moves
    .flatMap((move) => (move.lines as Row[]) ?? [])
    .find((row) => `line:${row.id}` === c.dialog?.params.id)
const selectedMove = (c: Context) =>
  c.data.record.moves.find(
    (row) => `move:${row.id}` === c.dialog?.params.id || row.id === selectedLine(c)?.moveId,
  )
const saveButton = (c: Context) => (
  <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />
)
export const transferModalDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.transfer',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id, creating) =>
      `/admin/stock/transfer/${creating ? 'new' : encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'transfer.create.title') : String(c.data.record.name)),
  status: (c) => (c.creating ? null : <Badge label={t(c, `state.${c.data.record.state}`)} />),
  body: (c) =>
    c.creating ? (
      <RecordModalForm kind={c.kind} command="create" fields={editFields(c)} actions={[saveButton(c)]} />
    ) : (
      <Stack
        items={[
          c.data.detailsHref ? (
            <LinkButton
              href={c.data.detailsHref}
              label={t(c, 'modal.relatedOperations')}
              variant="secondary"
            />
          ) : null,
          <Section
            title={t(c, 'modal.information')}
            actions={open(c) && c.data.permissions.savePicking ? dialog(c, 'edit', 'modal.edit') : null}
            body={
              <DescriptionList
                items={[
                  {
                    id: 'type',
                    label: t(c, 'field.operationType'),
                    value: String(
                      c.data.choices.pickingTypes?.find((row) => row.id === c.data.record.pickingTypeId)
                        ?.name ?? c.data.record.pickingTypeId,
                    ),
                  },
                  ...(['locationId', 'locationDestId'] as const).map((key, index) => ({
                    id: key,
                    label: t(c, index === 0 ? 'field.sourceLocation' : 'field.destinationLocation'),
                    value: String(
                      c.data.choices.locations?.find((row) => row.id === c.data.record[key])?.name ??
                        c.data.record[key],
                    ),
                  })),
                ]}
              />
            }
          />,
          <Section
            title={t(c, 'modal.products')}
            actions={open(c) && c.data.permissions.addMove ? dialog(c, 'add', 'action.addMove') : null}
            body={
              <DataTable
                rows={c.data.record.moves}
                id={(row) => String(row.id)}
                responsive="scroll"
                columns={[
                  { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
                  { key: 'demand', label: t(c, 'modal.demand'), cell: (row) => String(row.productUomQty) },
                  {
                    key: 'state',
                    label: t(c, 'transfer.list.col.state'),
                    cell: (row) => t(c, `state.${row.state}`),
                  },
                  {
                    key: 'operate',
                    label: t(c, 'modal.picked'),
                    cell: (row) =>
                      open(c) && c.data.permissions.saveMoveLine ? (
                        <RecordDialogTrigger dialog="line" id={`move:${row.id}`}>
                          <Button label={t(c, 'modal.recordPicked')} variant="tertiary" />
                        </RecordDialogTrigger>
                      ) : (
                        ''
                      ),
                  },
                ]}
              />
            }
          />,
          <Section
            title={t(c, 'modal.picked')}
            body={
              <DataTable
                rows={c.data.record.moves.flatMap((move) =>
                  ((move.lines as Row[]) ?? []).map((line): Row => ({ ...line, name: move.name })),
                )}
                id={(row) => String(row.id)}
                responsive="scroll"
                columns={[
                  { key: 'name', label: t(c, 'field.product'), cell: (row) => String(row.name) },
                  { key: 'quantity', label: t(c, 'modal.quantity'), cell: (row) => String(row.quantity) },
                  {
                    key: 'lot',
                    label: t(c, 'field.lot'),
                    cell: (row) =>
                      String(
                        c.data.choices.lots?.find((lot) => lot.id === row.lotId)?.name ?? row.lotId ?? '—',
                      ),
                  },
                  {
                    key: 'picked',
                    label: t(c, 'modal.picked'),
                    cell: (row) => t(c, row.picked ? 'modal.yes' : 'modal.no'),
                  },
                  {
                    key: 'edit',
                    label: t(c, 'modal.edit'),
                    cell: (row) =>
                      open(c) && c.data.permissions.saveMoveLine ? (
                        <RecordDialogTrigger dialog="line" id={`line:${row.id}`}>
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
    ),
  actions: (c) =>
    c.creating || !open(c) ? undefined : (
      <ActionGroup
        actions={[
          ...(c.data.record.state === 'draft' && c.data.permissions.confirmPicking
            ? [action(c, 'confirm', 'confirm')]
            : []),
          ...(c.data.record.state !== 'draft' && c.data.permissions.assignPicking
            ? [action(c, 'assign', 'assign')]
            : []),
          ...(c.data.record.state !== 'draft' && c.data.permissions.validatePicking
            ? [dialog(c, 'validate', 'action.validate')]
            : []),
          ...(c.data.permissions.cancelPicking ? [action(c, 'cancel', 'cancel')] : []),
        ]}
      />
    ),
  dialogs: {
    edit: {
      title: (c) => t(c, 'modal.edit'),
      view: (c) => (
        <RecordModalForm kind={c.kind} command="edit" fields={editFields(c)} actions={[saveButton(c)]} />
      ),
    },
    add: {
      title: (c) => t(c, 'action.addMove'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="add"
          fields={[
            field(c, 'productId', 'field.product', {
              type: 'select',
              options: options(c, 'products'),
              required: true,
            }),
            field(c, 'productUomId', 'field.uom', {
              type: 'select',
              options: options(c, 'units'),
              required: true,
            }),
            field(c, 'productUomQty', 'modal.demand', { type: 'decimal', value: '1', required: true }),
          ]}
          actions={[saveButton(c)]}
        />
      ),
    },
    line: {
      title: (c) => t(c, 'modal.recordPicked'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="line"
          fields={[
            field(c, 'quantity', 'modal.quantity', {
              type: 'decimal',
              value: String(selectedLine(c)?.quantity ?? '1'),
              required: true,
            }),
            field(c, 'lotId', 'field.lot', {
              type: 'select',
              value: String(selectedLine(c)?.lotId ?? ''),
              options: [
                { value: '', label: '—' },
                ...(c.data.choices.lots ?? [])
                  .filter((row) => row.productId === selectedMove(c)?.productId)
                  .map((row) => ({ value: String(row.id), label: String(row.name) })),
              ],
            }),
            {
              ...field(c, 'picked', 'modal.picked', { type: 'checkbox' }),
              value: c.draftChecked('picked', undefined, selectedLine(c)?.picked !== false),
            },
          ]}
          actions={[saveButton(c)]}
        />
      ),
    },
    validate: {
      title: (c) => t(c, 'action.validate'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="validate"
          fields={[
            field(c, 'backorder', 'modal.remaining', {
              type: 'radio',
              value: 'create',
              options: [
                { value: 'create', label: t(c, 'action.validateCreateBackorder') },
                { value: 'cancel', label: t(c, 'action.validateNoBackorder') },
              ],
              required: true,
            }),
          ]}
          actions={[
            <Button type="submit" label={t(c, 'action.validate')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    create: {
      fn: 'stock.createPicking',
      input: (form, c) => ({
        id: c.data.draftId,
        ...inputs(form, ['name', 'pickingTypeId', 'locationId', 'locationDestId', 'scheduledDate']),
      }),
      after: 'open',
    },
    edit: {
      fn: 'stock.savePicking',
      input: (form, c) => ({
        id: c.id,
        moveType: c.data.record.moveType,
        ...inputs(form, ['name', 'pickingTypeId', 'locationId', 'locationDestId', 'scheduledDate']),
      }),
      after: 'reload',
    },
    add: {
      fn: 'stock.addMove',
      input: (form, c) => ({
        id: c.data.draftId,
        pickingId: c.id,
        name: String(
          c.data.choices.products?.find((row) => row.id === form.get('productId'))?.name ??
            form.get('productId'),
        ),
        ...inputs(form, ['productId', 'productUomId', 'productUomQty']),
      }),
      after: 'reload',
    },
    line: {
      fn: 'stock.saveMoveLine',
      input: (form, c) => ({
        id: selectedLine(c)?.id ?? c.data.draftId,
        moveId: selectedMove(c)?.id,
        quantity: String(form.get('quantity') ?? ''),
        lotId: form.get('lotId') ? String(form.get('lotId')) : null,
        picked: form.has('picked'),
      }),
      after: 'reload',
    },
    confirm: { fn: 'stock.confirmPicking', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    assign: { fn: 'stock.assignPicking', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    validate: {
      fn: 'stock.validatePicking',
      input: (form, c) => ({ id: c.id, backorder: String(form.get('backorder') ?? 'create') }),
      after: 'reload',
    },
    cancel: {
      fn: 'stock.cancelPicking',
      input: (_form, c) => ({ id: c.id }),
      after: 'reload',
      confirm: (c) => t(c, 'modal.confirmCancel'),
    },
  },
}
export const transferModal = createRecordModal(transferModalDefinition)
