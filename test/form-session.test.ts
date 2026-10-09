import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFormSession,
  defineFormContract,
  formActionTransport,
  formIssuePath,
  validateForm,
  validationIssue,
} from '@ketvietlab/ketjs-view'
import type { FormOutcome, FormSubmission } from '@ketvietlab/ketjs-view'

type Setup = {
  name: string
  note: string | null
  active: boolean
  variants: Array<{
    rowKey: string
    id: string | null
    barcode: string | null
    weight: string
    valueIds: Record<string, string>
  }>
}
const contract = defineFormContract<Setup>('example.variant-setup.v1', {
  fields: {
    name: { required: true, trim: true },
    note: { nullable: true, empty: 'null', required: true },
    active: { type: 'bool', default: false },
    variants: {
      type: 'array',
      required: true,
      maxItems: 4,
      key: 'rowKey',
      items: {
        type: 'object',
        fields: {
          rowKey: { type: 'id', required: true },
          id: { type: 'id', required: true, nullable: true },
          barcode: { nullable: true, empty: 'null', required: true },
          weight: { type: 'decimal', required: true, min: 0 },
          valueIds: { type: 'record', required: true, entries: { type: 'id', required: true } },
        },
      },
    },
  },
})
const initial = (): Setup => ({
  name: 'Tea',
  note: null,
  active: true,
  variants: [{ rowKey: 'draft-1', id: null, barcode: null, weight: '1', valueIds: { color: 'red' } }],
})

test('nested forms reject malformed replacement lists, foreign fields, limits and duplicate keys', () => {
  for (const variants of [
    {},
    null,
    '[]',
    [null],
    [{ ...initial().variants[0], weight: 'bad' }],
    Array(5).fill(initial().variants[0]),
    [initial().variants[0], initial().variants[0]],
  ]) {
    assert.equal(validateForm(contract.schema, { ...initial(), variants }).valid, false)
  }
  assert.equal(validateForm(contract.schema, { ...initial(), variants: [] }).valid, true)
  assert.equal(
    validateForm(contract.schema, { ...initial(), variants: [{ ...initial().variants[0], admin: true }] })
      .valid,
    false,
  )
  const invalid = validateForm(contract.schema, {
    ...initial(),
    variants: [{ ...initial().variants[0], weight: 'bad' }],
  })
  assert.deepEqual(invalid.issues[0].path, ['variants', { key: 'draft-1' }, 'weight'])
  assert.equal(invalid.issues[0].field, 'variants.0.weight')
})

test('explicit null, blank clearing, unchecked false and empty arrays survive normalization', () => {
  assert.equal(validateForm(contract.schema, { ...initial(), name: '   ' }).valid, false)
  const result = validateForm(contract.schema, { ...initial(), note: '', active: false, variants: [] })
  assert.equal(result.valid, true)
  assert.deepEqual(result.values, { name: 'Tea', note: null, active: false, variants: [] })
  const absent = { ...initial() } as Record<string, unknown>
  delete absent.note
  assert.equal(validateForm(contract.schema, absent).valid, false)
  const raw = JSON.parse('{"__proto__":"safe"}')
  const safe = validateForm({ fields: { ['__proto__']: { required: true } } }, raw)
  assert.equal(Object.getPrototypeOf(safe.values), Object.prototype)
  assert.equal(Object.hasOwn(safe.values, '__proto__'), true)
})

test('native blank and boolean representations do not make an unchanged draft dirty', () => {
  const session = createFormSession(contract, {
    initial: initial(),
    recordId: 'p1',
    revision: 'r0',
    transport: async () => ({ status: 'conflict', issues: [] }),
  })
  session.set('note', '')
  session.set('active', 'true')
  assert.equal(session.dirty(), false)
  assert.equal('set' in session.values, false)
  session.dispose()
})

test('a server index is mapped with the submitted row keys', () => {
  assert.deepEqual(formIssuePath(contract, initial(), 'variants.0.valueIds.color'), [
    'variants',
    { key: 'draft-1' },
    'valueIds',
    'color',
  ])
})

test('session owns immutable snapshots, single-flight submit and the accepted baseline', async () => {
  let finish!: (outcome: FormOutcome<Setup>) => void
  let received!: Readonly<FormSubmission<Setup>>
  const input = initial()
  const session = createFormSession(contract, {
    initial: input,
    recordId: 'p1',
    revision: 'r0',
    transport: (submission) => {
      received = submission
      return new Promise<FormOutcome<Setup>>((resolve) => {
        finish = resolve
      })
    },
  })
  input.variants[0].weight = '99'
  assert.equal(session.values().variants[0].weight, '1')
  session.set('name', '  Coffee  ')
  const one = session.submit()
  assert.equal(session.submit(), one)
  assert.equal(session.set('name', 'lost'), false)
  assert.equal(session.reset(), false)
  await Promise.resolve()
  assert.equal(received.values.name, 'Coffee')
  finish({
    status: 'committed',
    accepted: { ...received.values, variants: [{ ...received.values.variants[0], id: 'v1' }] },
    revision: 'r1',
    value: {},
  })
  assert.equal((await one).status, 'committed')
  assert.equal(session.values().variants[0].id, 'v1')
  assert.equal(session.dirty(), false)
  assert.equal(session.revision(), 'r1')
  session.dispose()
})

test('an unknown outcome retains the exact intent until retry resolves it', async () => {
  const calls: Readonly<FormSubmission<Setup>>[] = []
  const session = createFormSession(contract, {
    initial: initial(),
    recordId: 'p1',
    revision: 'r0',
    transport: async (input) => {
      calls.push(input)
      if (calls.length === 1) throw new Error('response lost after commit')
      return { status: 'committed', accepted: input.values, revision: 'r1', value: {} }
    },
  })
  session.set('name', 'Coffee')
  assert.equal((await session.submit()).status, 'unknown')
  assert.equal(session.dirty(), true)
  assert.equal(session.receive({ values: initial(), revision: 'r1' }), false)
  assert.equal(session.set('name', 'other'), false)
  await session.retry()
  assert.equal(calls[0], calls[1])
  assert.equal(session.locked(), false)
  session.dispose()
})

test('refusals retain drafts and unrelated server issues; dirty scopes refuse background refresh', async () => {
  const session = createFormSession(contract, {
    initial: initial(),
    recordId: 'p1',
    revision: 'r0',
    transport: async () => ({
      status: 'invalid',
      issues: [validationIssue('name', 'taken'), validationIssue('variants.0.barcode', 'taken')],
    }),
  })
  session.set('name', 'Coffee')
  await session.submit()
  session.set('name', 'Green tea')
  assert.equal(session.errors('variants.0.barcode').length, 1)
  assert.equal(session.errors('name').length, 0)
  assert.equal(session.receive({ values: initial(), revision: 'r2' }), false)
  assert.equal(session.revision(), 'r0')
  assert.equal(session.reset(), true)
  assert.equal(session.receive({ values: initial(), revision: 'r2' }), true)
  session.dispose()
})

test('transport sends one intent through the existing function boundary and refuses non-outcomes', async () => {
  let body: Record<string, unknown> = {}
  const transport = formActionTransport<Setup>('product.save', {
    fetch: async (url, options) => {
      assert.equal(url, '/_ket/fn/product.save')
      assert.equal((options!.headers as Record<string, string>)['idempotency-key'], 'intent-1')
      body = JSON.parse(String(options!.body))
      return Response.json({
        ok: true,
        value: { status: 'committed', accepted: initial(), revision: 'r1', value: {} },
      })
    },
  })
  const result = await transport(
    {
      contractId: contract.id,
      recordId: 'p1',
      mutationId: 'intent-1',
      expectedRevision: 'r0',
      values: initial(),
    },
    new AbortController().signal,
  )
  assert.equal(result.status, 'committed')
  assert.equal(Object.hasOwn(body, 'mutationId'), false)
})

test('nested attribute values keep two stable keys and bound cross-field validation', () => {
  let refinements = 0
  const schema = {
    fields: {
      lines: {
        type: 'array' as const,
        required: true,
        key: 'attributeId',
        items: {
          type: 'object' as const,
          fields: {
            attributeId: { required: true },
            values: {
              type: 'array' as const,
              required: true,
              key: 'valueId',
              items: {
                type: 'object' as const,
                fields: {
                  valueId: { required: true },
                  priceExtra: { type: 'decimal' as const, required: true },
                },
              },
            },
          },
        },
      },
    },
    validate: () => {
      refinements++
      return true as const
    },
  }
  const invalid = validateForm(schema, {
    lines: [{ attributeId: 'size', values: [{ valueId: 'large', priceExtra: 'bad' }] }],
  })
  assert.equal(invalid.valid, false)
  assert.deepEqual(invalid.issues[0].path, [
    'lines',
    { key: 'size' },
    'values',
    { key: 'large' },
    'priceExtra',
  ])
  assert.equal(invalid.issues[0].field, 'lines.0.values.0.priceExtra')
  assert.equal(refinements, 0)
  assert.equal(validateForm(schema, { lines: [] }).valid, true)
  assert.equal(refinements, 1)
})

test('array keys stay unique after normalization', () => {
  const result = validateForm(
    {
      fields: {
        rows: {
          type: 'array',
          key: 'key',
          items: { type: 'object', fields: { key: { required: true, trim: true } } },
        },
      },
    },
    { rows: [{ key: 'one' }, { key: ' one ' }] },
  )
  assert.equal(result.valid, false)
  assert.ok(result.issues.some((issue) => issue.code === 'row_key'))
})

test('a malformed refusal is an uncertain result, not a corrupted issue signal', async () => {
  const session = createFormSession(contract, {
    initial: initial(),
    recordId: 'p1',
    revision: 'r0',
    transport: async () => ({ status: 'invalid', issues: null }) as unknown as FormOutcome<Setup>,
  })
  assert.equal((await session.submit()).status, 'unknown')
  assert.deepEqual(session.issues(), [])
  assert.equal(session.locked(), true)
  session.dispose()
})
