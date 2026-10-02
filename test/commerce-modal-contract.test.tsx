import { vendorPricelistDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/pricelist-view.tsx'
import { invoicingPolicyDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/policy-view.tsx'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { html as template, renderToString } from '@ketvietlab/ketjs-view'
import { validateInput } from '../packages/ketjs/src/server/fn.ts'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import type {
  RecordModalContext,
  RecordModalDefinition,
} from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { purchaseOrderModalDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/order-modal-view.tsx'
import { saleOrderModalDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { inventoryCountDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/inventory-view.tsx'

const context = <T,>(
  definition: RecordModalDefinition<T>,
  record: Record<string, unknown> = {},
): RecordModalContext<T> => ({
  kind: definition.kind,
  id: 'record-1',
  creating: false,
  tab: 'info',
  busy: false,
  dialog: { name: 'editLine', params: { id: 'line-1' } },
  data: {
    record: {
      id: 'record-1',
      name: 'Record',
      state: 'draft',
      revision: 2,
      lines: [{ id: 'line-1', taxId: 'tax-1' }],
      moves: [{ id: 'move-1', lines: [{ id: 'line-1', moveId: 'move-1' }] }],
      pickings: [],
      bills: [],
      invoices: [],
      ...record,
    },
    draftId: 'request-1',
    choices: {},
    rules: [],
    products: [],
    locations: [],
    lots: [],
    permissions: {},
    save: false,
    rule: false,
    run: false,
  } as T,
  t: (key) => key,
  fieldError: () => null,
  draft: (_name, value = '') => value,
  draftChecked: (_name, _value, fallback = false) => fallback,
  state: (_name, value = '') => value,
  href: () => '',
  outcome: <V,>() =>
    ({
      input: {
        productId: 'product-1',
        locationId: 'location-1',
        countedQuantity: '1',
        productUomId: 'unit-1',
        expectedQuantRevision: 0,
      },
    }) as V,
})

test('every Commerce modal command satisfies its real public function input schema', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const check = <T,>(definition: RecordModalDefinition<T>) => {
    for (const [name, command] of Object.entries(definition.commands ?? {})) {
      assert.ok(command.fn, `${definition.kind}.${name} must use a domain function`)
      const fn = app.deployment.manifest.functions[command.fn]
      assert.ok(fn, `${command.fn} must exist`)
      const form = new FormData()
      for (const [field, type] of Object.entries(fn.input ?? {}))
        form.set(
          field,
          type.startsWith('int') || type.startsWith('decimal')
            ? '2'
            : type.startsWith('datetime')
              ? '2026-09-29'
              : 'value',
        )
      form.set('taxId', 'tax-1')
      form.set('receiptId', 'receipt-1')
      const c = context(definition)
      if (definition.kind === 'stock.transfer') c.dialog = { name: 'line', params: { id: 'line:line-1' } }
      const args = command.input(form, c, {})
      assert.doesNotThrow(
        () => validateInput(command.fn!, app.deployment.manifest, args),
        `${definition.kind}.${name}: ${JSON.stringify(args)}`,
      )
    }
  }
  check(purchaseOrderModalDefinition)
  check(saleOrderModalDefinition)
  for (const key of ['warehouse', 'location', 'picking-type', 'lot', 'route', 'replenishment'])
    check(stockConfigurationDefinition(key))
  check(inventoryCountDefinition)
  check(transferModalDefinition)
  check(vendorPricelistDefinition)
  check(invoicingPolicyDefinition)
})

test('read-only purchase and sale modal hide mutations; sent and external orders keep domain boundaries', () => {
  for (const definition of [purchaseOrderModalDefinition, saleOrderModalDefinition]) {
    const c = context(definition as RecordModalDefinition<unknown>)
    const html = renderToString(template`${definition.body!(c as never)}`)
    assert.doesNotMatch(html, /data-record-dialog=/)
    assert.doesNotMatch(renderToString(template`${definition.actions!(c as never)}`), /type="submit"/)
  }
  const c = context(saleOrderModalDefinition, { orderAuthority: 'external', state: 'sale' })
  c.data.permissions = {
    confirmOrder: true,
    cancelOrder: true,
    createInvoice: true,
    lockOrder: true,
    addLine: true,
    updateLine: true,
  }
  assert.doesNotMatch(renderToString(template`${saleOrderModalDefinition.body!(c)}`), /data-record-dialog=/)
  assert.equal(saleOrderModalDefinition.actions!(c), undefined)
})

test('Commerce modal views resolve Vietnamese and English labels from the real catalogue', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const definitions: RecordModalDefinition<unknown>[] = [
    purchaseOrderModalDefinition,
    saleOrderModalDefinition,
    transferModalDefinition,
    vendorPricelistDefinition,
    invoicingPolicyDefinition,
    inventoryCountDefinition,
    ...['warehouse', 'location', 'picking-type', 'lot', 'route', 'replenishment'].map(
      stockConfigurationDefinition,
    ),
  ] as RecordModalDefinition<unknown>[]
  for (const lang of ['vi', 'en']) {
    const messages = app.deployment.manifest.messages?.[lang] ?? {}
    const missing = new Set<string>()
    for (const definition of definitions) {
      for (const state of ['draft', 'sent', 'purchase', 'sale', 'assigned']) {
        const c = context(definition, { state, display: {}, moves: [], lines: [] })
        Object.assign(c.data as object, {
          rows: [],
          save: true,
          rule: true,
          run: true,
          permissions: new Proxy({}, { get: () => true }),
        })
        c.t = (key) => {
          if (!(key in messages) && !key.startsWith('recordModal.')) missing.add(key)
          return String(messages[key] ?? key)
        }
        for (const creating of [false, true]) {
          c.creating = creating
          renderToString(template`${definition.body?.(c)}${definition.actions?.(c)}`)
          for (const tab of definition.tabs ?? []) {
            if (!tab.visible || tab.visible(c)) {
              tab.label(c)
              renderToString(template`${tab.view(c)}`)
            }
          }
          for (const [name, dialog] of Object.entries(definition.dialogs ?? {})) {
            c.dialog = { name, params: { id: 'line-1' } }
            renderToString(template`${dialog.view(c)}`)
          }
        }
      }
    }
    assert.deepEqual([...missing].sort(), [], `${lang} modal labels missing`)
  }
})
