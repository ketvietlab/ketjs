import { defineFormContract, validateForm } from '../../packages/ketjs-view/dist/index.js'

export const get = (value, path) => path.split('.').reduce((held, key) => held?.[key], value)
export function put(value, path, held) {
  const parts = path.split('.')
  let target = value
  for (let n = 0; n < parts.length - 1; n++) {
    const key = parts[n]
    target = target[key] ??= /^\d+$/.test(parts[n + 1]) ? [] : {}
  }
  target[parts.at(-1)] = held
  return value
}

export function workload(kind, size, metrics) {
  const fieldRule = (type = 'text') => ({
    type,
    required: true,
    validate: () => {
      if (metrics.enabled) metrics.validationRuleCalls++
      return true
    },
  })
  let fields, initial, controls
  if (kind === 'flat') {
    fields = Object.fromEntries(Array.from({ length: size }, (_, n) => [`field${n}`, fieldRule()]))
    initial = Object.fromEntries(Array.from({ length: size }, (_, n) => [`field${n}`, `value-${n}`]))
    controls = Object.keys(fields).map((name) => ({ name, type: 'text' }))
  } else {
    fields = {
      title: fieldRule(),
      variants: {
        type: 'array',
        required: true,
        key: 'rowKey',
        maxItems: 500,
        items: {
          type: 'object',
          fields: {
            rowKey: fieldRule(),
            id: { type: 'id', required: true, nullable: true },
            weight: fieldRule('decimal'),
            active: fieldRule('bool'),
            valueIds: { type: 'record', required: true, entries: fieldRule() },
          },
        },
      },
    }
    initial = {
      title: 'Variants',
      variants: Array.from({ length: size }, (_, n) => ({
        rowKey: `row-${n}`,
        id: null,
        weight: '1.00',
        active: true,
        valueIds: { color: 'blue' },
      })),
    }
    controls = [
      { name: 'title', type: 'text' },
      ...initial.variants.flatMap((_, n) => [
        { name: `variants.${n}.weight`, type: 'text' },
        { name: `variants.${n}.active`, type: 'checkbox' },
        { name: `variants.${n}.valueIds.color`, type: 'text' },
      ]),
    ]
  }
  const contract = defineFormContract(`bench.${kind}.${size}`, {
    fields,
    validate: () => {
      if (metrics.enabled) metrics.schemaRefinements++
      return true
    },
  })
  const target = kind === 'flat' ? `field${Math.floor(size / 2)}` : `variants.${Math.floor(size / 2)}.weight`
  const spec = { kind, size, initial, controls, contract, target }
  spec.validValue = (n) => (kind === 'flat' ? `edited-${n}` : `${n + 2}.25`)
  spec.invalidValue = kind === 'flat' ? '' : 'bad'
  spec.validate = (values) => validateForm(contract.schema, values)
  return spec
}

export function errorsOf(issues, objectErrors = false) {
  const errors = {}
  for (const issue of issues)
    if (issue.field && !get(errors, issue.field))
      put(errors, issue.field, objectErrors ? { type: issue.code, message: issue.code } : issue.code)
  return errors
}

export function stats(samples) {
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample) || sample < 0))
    throw new Error('expected non-empty, finite, non-negative timing samples')
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    samples,
    count: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  }
}
