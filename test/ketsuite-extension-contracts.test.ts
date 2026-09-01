import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountFunctionSpecs, pricingFunctionSpecs, productBackend } from '@ketvietlab/ketsuite'

test('KetSuite exports stable pricing and account composition contracts', () => {
  assert.equal(pricingFunctionSpecs.priceFor?.agent, true)
  assert.equal(accountFunctionSpecs.quoteLine?.agent, true)
  assert.deepEqual(pricingFunctionSpecs.priceFor?.input, {
    pricelistId: 'id',
    productId: 'id',
    quantity: 'decimal',
    uomId: 'id?',
    date: 'datetime?',
  })
  assert.deepEqual(accountFunctionSpecs.quoteLine?.input, {
    productId: 'id?',
    taxIds: 'json?',
    quantity: 'decimal',
    priceUnit: 'decimal',
    discount: 'decimal?',
  })
})

test('KetSuite publishes Product Template operation entry points', () => {
  assert.deepEqual(productBackend.joints['catalogue.actions'], {
    props: { locale: 'text?' },
    multiple: true,
  })
  assert.deepEqual(productBackend.joints['template.actions'], {
    props: { templateId: 'id', locale: 'text?' },
    multiple: true,
  })
})
