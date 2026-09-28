import { Button, DescriptionList, DataTable, Section, Stack } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordModalForm,
  RecordDialogTrigger,
  RecordActionForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { stockConfigurations } from './configuration.ts'
import type { ConfigurationField } from './configuration.ts'
type Row = Record<string, unknown>
type Data = {
  record: Row
  save: boolean
  rule: boolean
  run: boolean
  rules: Row[]
  quants?: Row[]
  draftId: string
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, label: string) => c.t(`stock_backend.${label}`)
const ruleFields: ConfigurationField[] = [
  { name: 'name', label: 'stockRoute.rule.col.name', required: true },
  {
    name: 'action',
    label: 'field.ruleAction',
    choices: ['pull', 'push', 'pull_push'],
    choiceLabel: 'ruleAction',
    defaultValue: 'pull',
    required: true,
  },
  { name: 'locationSrcId', label: 'field.sourceLocation', lookup: 'locations' },
  { name: 'locationDestId', label: 'field.destinationLocation', lookup: 'locations', required: true },
  { name: 'pickingTypeId', label: 'field.operationType', lookup: 'pickingTypes', required: true },
  { name: 'sequence', label: 'field.sequence', type: 'number', defaultValue: '20' },
  {
    name: 'procureMethod',
    label: 'field.procureMethod',
    choices: ['make_to_stock', 'make_to_order', 'mts_else_mto'],
    choiceLabel: 'procureMethod',
    defaultValue: 'make_to_stock',
  },
]
const formFields = (c: Context, fields: ConfigurationField[], record: Row): FieldProps[] =>
  fields.map((field) => ({
    id: `${c.kind}-${c.dialog?.name ?? 'record'}-${field.name}`,
    name: field.name,
    label: t(c, field.label),
    type: field.type,
    required: field.required,
    value: c.draft(field.name, String(record[field.name] ?? field.defaultValue ?? '')),
    error: c.fieldError(field.name),
    disabled: c.busy,
    ...(field.choices
      ? {
          type: 'select' as const,
          options: field.choices.map((value) => ({ value, label: t(c, `${field.choiceLabel}.${value}`) })),
        }
      : {}),
    ...(field.lookup
      ? {
          type: 'select' as const,
          options: [
            { value: '', label: '—' },
            ...(c.data.choices[field.lookup] ?? [])
              .filter((row) => field.name !== 'parentId' || row.id !== c.id)
              .map((row) => ({ value: String(row.id), label: String(row.name) })),
          ],
        }
      : {}),
  }))
const values = (form: FormData, fields: ConfigurationField[]) =>
  Object.fromEntries(
    fields.flatMap<[string, unknown]>((field) => {
      const value = String(form.get(field.name) ?? '')
      if (field.type === 'number') return value ? [[field.name, Number(value)]] : []
      return value || field.required
        ? [[field.name, value]]
        : field.lookup
          ? [[field.name, null]]
          : field.type === 'textarea' || !field.type
            ? [[field.name, '']]
            : []
    }),
  )
const selectedRule = (c: Context) => c.data.rules.find((row) => row.id === c.dialog?.params.id)
export const stockConfigurationDefinition = (key: string): RecordModalDefinition<Data> => {
  const config = stockConfigurations[key]!
  return {
    kind: config.kind,
    size: 'large',
    labels: () => USER_RECORD_MODAL_LABELS[lang()],
    context: {
      route: (id, creating) =>
        `/admin/stock/record/${key}/${creating ? 'new' : encodeURIComponent(id)}/context?lang=${lang()}`,
      query: ['company', 'branch'],
    },
    title: (c) =>
      c.creating
        ? t(c, config.title)
        : String(
            c.data.record.name ??
              c.data.choices.products?.find((row) => row.id === c.data.record.productId)?.name ??
              c.id,
          ),
    body: (c) => (
      <Stack
        items={[
          c.data.save ? (
            <RecordModalForm
              kind={c.kind}
              command="save"
              fields={formFields(c, config.fields, c.data.record)}
              actions={[
                <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />,
              ]}
            />
          ) : (
            <DescriptionList
              items={config.fields.map((field) => ({
                id: field.name,
                label: t(c, field.label),
                value: field.choices
                  ? t(c, `${field.choiceLabel}.${c.data.record[field.name]}`)
                  : String(
                      (field.lookup
                        ? c.data.choices[field.lookup]?.find((row) => row.id === c.data.record[field.name])
                            ?.name
                        : null) ??
                        c.data.record[field.name] ??
                        '—',
                    ),
              }))}
            />
          ),
          ...(key === 'lot' && !c.creating
            ? [
                <Section
                  title={t(c, 'lot.inventory.title')}
                  body={
                    <DataTable
                      rows={c.data.quants ?? []}
                      id={(row) => String(row.id)}
                      responsive="scroll"
                      columns={[
                        {
                          key: 'location',
                          label: t(c, 'lot.col.location'),
                          cell: (row) =>
                            String(
                              c.data.choices.locations?.find((location) => location.id === row.locationId)
                                ?.name ?? row.locationId,
                            ),
                        },
                        {
                          key: 'quantity',
                          label: t(c, 'lot.col.onHand'),
                          cell: (row) => String(row.quantity),
                        },
                        {
                          key: 'reserved',
                          label: t(c, 'lot.col.reserved'),
                          cell: (row) => String(row.reservedQuantity),
                        },
                        {
                          key: 'available',
                          label: t(c, 'lot.col.available'),
                          cell: (row) => String(Number(row.quantity) - Number(row.reservedQuantity)),
                        },
                      ]}
                    />
                  }
                />,
              ]
            : []),
          ...(key === 'route' && !c.creating
            ? [
                <Section
                  title={t(c, 'stockRoute.rule.col.name')}
                  actions={
                    c.data.rule ? (
                      <RecordDialogTrigger dialog="rule">
                        <Button label={t(c, 'stockRoute.rule.create.title')} />
                      </RecordDialogTrigger>
                    ) : null
                  }
                  body={
                    <DataTable
                      rows={c.data.rules}
                      id={(row) => String(row.id)}
                      responsive="scroll"
                      columns={[
                        {
                          key: 'name',
                          label: t(c, 'stockRoute.rule.col.name'),
                          cell: (row) => String(row.name),
                        },
                        {
                          key: 'action',
                          label: t(c, 'field.ruleAction'),
                          cell: (row) => t(c, `ruleAction.${row.action}`),
                        },
                        {
                          key: 'sequence',
                          label: t(c, 'field.sequence'),
                          cell: (row) => String(row.sequence),
                        },
                        {
                          key: 'edit',
                          label: t(c, 'action.save'),
                          cell: (row) =>
                            c.data.rule ? (
                              <RecordDialogTrigger dialog="rule" id={String(row.id)}>
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
              ]
            : []),
          ...(key === 'replenishment' && !c.creating && c.data.run
            ? [
                <RecordActionForm kind={c.kind} command="run">
                  <Button type="submit" label={t(c, 'action.run')} disabled={c.busy} />
                </RecordActionForm>,
              ]
            : []),
        ]}
      />
    ),
    dialogs: {
      rule: {
        title: (c) => t(c, 'stockRoute.rule.col.name'),
        view: (c) => (
          <RecordModalForm
            kind={c.kind}
            command="rule"
            fields={formFields(c, ruleFields, selectedRule(c) ?? {})}
            actions={[
              <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />,
            ]}
          />
        ),
      },
    },
    commands: {
      save: {
        fn: config.save,
        after: 'open',
        input: (form, c) => ({ id: c.creating ? c.data.draftId : c.id, ...values(form, config.fields) }),
      },
      rule: {
        fn: 'stock.saveRule',
        after: 'reload',
        input: (form, c) => ({
          id: selectedRule(c)?.id ?? c.data.draftId,
          routeId: c.id,
          ...values(form, ruleFields),
        }),
      },
      run: {
        fn: 'stock.runOrderpoint',
        after: 'reload',
        input: (_form, c) => ({ id: c.id, moveId: c.data.draftId }),
        confirm: (c) => t(c, 'modal.confirmRun'),
      },
    },
  }
}
export const warehouseModal = createRecordModal(stockConfigurationDefinition('warehouse'))
export const locationModal = createRecordModal(stockConfigurationDefinition('location'))
export const pickingTypeModal = createRecordModal(stockConfigurationDefinition('picking-type'))
export const lotModal = createRecordModal(stockConfigurationDefinition('lot'))
export const stockRouteModal = createRecordModal(stockConfigurationDefinition('route'))
export const replenishmentModal = createRecordModal(stockConfigurationDefinition('replenishment'))
