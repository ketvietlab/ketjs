import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  emptyState,
  FormCluster,
  FormPage,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { ActionVariant, FormOption, Frame } from '../../../ui/index.ts'
import { selectionLabel as resolveSelection } from '../../backend/screen.ts'
import { stockRowsTable } from './shared.tsx'
import type { StockRow } from './shared.tsx'

export type TransferDetail = {
  id: string
  name: string
  state: string
  scheduledDate: string
  pickingTypeName: string
}

export type TransferDetailOptions = {
  transfer: TransferDetail
  rows: StockRow[]
  products: FormOption[]
  units: FormOption[]
  lots: FormOption[]
  operationOptions: FormOption[]
  backorderPolicy: string
  action: string
  collaboration: JSXChild
  editor: JSXChild
  printActions?: JSXChild
  errors?: string[]
}

/** A stable stock code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'stock_backend', group, value)

const stateTone = (state: string) =>
  state === 'done' ? 'positive' : state === 'cancel' ? 'danger' : state === 'draft' ? 'neutral' : 'info'

const ActionForm = ({
  action,
  value,
  label,
  variant,
  hidden = {},
}: {
  action: string
  value: string
  label: string
  variant: ActionVariant
  hidden?: Record<string, string>
}): TemplateResult => (
  <RecordForm
    scope="stock-transfer"
    action={action}
    submit={label}
    submitVariant={variant}
    layout="inline"
    hidden={{ action: value, ...hidden }}
    fields={[]}
  />
)

export const transferDetailScreen = (
  _: Translator,
  options: TransferDetailOptions,
  frame: Frame,
  partial = false,
): TemplateResult => {
  const { transfer } = options
  const editable = !['done', 'cancel'].includes(transfer.state)
  const actions: TemplateResult[] = editable
    ? [
        transfer.state === 'draft' ? (
          <ActionForm
            action={options.action}
            value="confirm"
            label={_('stock_backend.action.confirm')}
            variant="primary"
          />
        ) : (
          <ActionForm
            action={options.action}
            value="assign"
            label={_('stock_backend.action.assign')}
            variant="primary"
          />
        ),
        ...(transfer.state === 'draft'
          ? []
          : options.backorderPolicy === 'ask'
            ? [
                <ActionForm
                  action={options.action}
                  value="validate"
                  label={_('stock_backend.action.validateCreateBackorder')}
                  variant="secondary"
                  hidden={{ backorder: 'create' }}
                />,
                <ActionForm
                  action={options.action}
                  value="validate"
                  label={_('stock_backend.action.validateNoBackorder')}
                  variant="secondary"
                  hidden={{ backorder: 'cancel' }}
                />,
              ]
            : [
                <ActionForm
                  action={options.action}
                  value="validate"
                  label={_('stock_backend.action.validate')}
                  variant="secondary"
                />,
              ]),
        <ActionForm
          action={options.action}
          value="cancel"
          label={_('stock_backend.action.cancel')}
          variant="destructive"
        />,
      ]
    : []
  const operations = options.rows.length
    ? stockRowsTable(_, options.rows)
    : emptyState(
        _('stock_backend.transfer.operations.empty'),
        _('stock_backend.transfer.operations.emptyHint'),
      )
  const description = [
    transfer.pickingTypeName,
    transfer.scheduledDate ? `${_('stock_backend.field.scheduledDate')}: ${transfer.scheduledDate}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const page = (
    <FormPage
      scope="stock-transfer-form-page"
      title={transfer.name}
      description={description}
      status={badge(selectionLabel(_, 'state', transfer.state), stateTone(transfer.state), transfer.state)}
      actions={
        actions.length ? (
          <FormCluster forms={actions} label={_('stock_backend.transfer.actions.label')} />
        ) : undefined
      }
      controller={options.editor}
      body={stack(
        [
          options.printActions === undefined ? null : <Surface body={options.printActions} />,
          <Section
            title={_('stock_backend.transfer.operations.title')}
            description={_('stock_backend.transfer.operations.hint')}
            body={operations}
          />,
          editable ? (
            <Section
              title={_('stock_backend.transfer.addMove.title')}
              description={_('stock_backend.transfer.addMove.hint')}
              body={
                <Surface
                  padding="compact"
                  body={
                    <RecordForm
                      scope="stock-transfer"
                      action={options.action}
                      submit={_('stock_backend.action.addMove')}
                      submitVariant="secondary"
                      hidden={{ action: 'add-move' }}
                      errors={options.errors}
                      fields={[
                        { name: 'name', label: _('stock_backend.col.name') },
                        {
                          name: 'productId',
                          label: _('stock_backend.field.productId'),
                          type: 'select',
                          options: options.products,
                          required: true,
                        },
                        {
                          name: 'productUomId',
                          label: _('stock_backend.field.uom'),
                          type: 'select',
                          options: options.units,
                          required: true,
                        },
                        {
                          name: 'productUomQty',
                          label: _('stock_backend.field.demand'),
                          type: 'decimal',
                          required: true,
                        },
                      ]}
                    />
                  }
                />
              }
            />
          ) : null,
          editable && options.operationOptions.length ? (
            <Section
              title={_('stock_backend.transfer.recordDone.title')}
              description={_('stock_backend.transfer.recordDone.hint')}
              body={
                <Surface
                  padding="compact"
                  body={
                    <RecordForm
                      scope="stock-transfer"
                      action={options.action}
                      submit={_('stock_backend.action.recordDone')}
                      submitVariant="secondary"
                      hidden={{ action: 'pick' }}
                      errors={options.errors}
                      fields={[
                        {
                          name: 'operationId',
                          label: _('stock_backend.field.operationLine'),
                          type: 'select',
                          options: options.operationOptions,
                          required: true,
                        },
                        {
                          name: 'quantity',
                          label: _('stock_backend.field.doneQuantity'),
                          type: 'decimal',
                          required: true,
                        },
                        {
                          name: 'lotId',
                          label: _('stock_backend.field.lot'),
                          type: 'select',
                          options: [{ value: '', label: '—' }, ...options.lots],
                        },
                      ]}
                    />
                  }
                />
              }
            />
          ) : null,
        ],
        'loose',
      )}
      aside={options.collaboration}
      asideLabel={_('stock_backend.transfer.collaboration.label')}
      slots={{
        header: 'stock.transfer-header',
        body: 'stock.transfer-body',
        ...(partial ? { fragmentTitle: transfer.name } : {}),
      }}
    />
  )

  return partial ? page : shell(_, transfer.name, page, { ...frame, topbar: false, titled: false })
}
