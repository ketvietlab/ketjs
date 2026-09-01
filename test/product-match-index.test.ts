import assert from 'node:assert/strict'
import { test } from 'node:test'
import { models } from '../packages/ketsuite/src/modules/product/models.ts'

const fields = (model: keyof typeof models, index: string): string[] =>
  models[model]?.indexes?.[index]?.fields ?? []

test('product matching can walk every exact evidence key through an index', () => {
  assert.deepEqual(fields('Template', 'name'), ['name'])
  assert.deepEqual(fields('Product', 'default_code'), ['defaultCode'])
  assert.deepEqual(fields('Product', 'barcode_unique'), ['barcode'])
  assert.deepEqual(fields('Attribute', 'name'), ['name'])
  assert.deepEqual(fields('AttributeValue', 'attribute_name'), ['attributeId', 'name'])
  assert.deepEqual(fields('AttributeValue', 'name'), ['name'])
  assert.deepEqual(fields('TemplateAttributeValue', 'value'), ['valueId'])
  assert.deepEqual(fields('ProductValue', 'template_attribute_value'), ['templateAttributeValueId'])
})
