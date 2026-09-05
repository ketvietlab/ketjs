import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FormValidationError,
  assertForm,
  createForm,
  defineFormSchema,
  invalidForm,
  issuesFromFieldErrors,
  validateForm,
  validationIssue,
  valuesFromFormData,
} from '@ketvietlab/ketjs'

type Signup = {
  email: string
  age: number
  roles: string[]
  password: string
  confirmation: string
}

const signup = defineFormSchema<Signup>({
  fields: {
    email: { type: 'text', required: true, trim: true, pattern: /^[^@]+@[^@]+$/ },
    age: { type: 'int', required: true, min: 18, max: 120 },
    roles: { type: 'text', required: true, multiple: true, oneOf: ['buyer', 'seller'] },
    password: { type: 'text', required: true, minLength: 8, maxLength: 128 },
    confirmation: { type: 'text', required: true },
  },
  unknown: 'reject',
  validate: (values) =>
    values.password === values.confirmation
      ? true
      : validationIssue('confirmation', 'confirmation', 'signup.passwordConfirmation'),
})

test('form validation: one schema casts values and returns stable field and form issues', () => {
  const result = validateForm(signup, {
    email: '  person@example.test ',
    age: '16',
    roles: ['buyer', 'owner'],
    password: 'secret',
    confirmation: 'different',
    admin: '1',
  })

  assert.equal(result.valid, false)
  assert.deepEqual(result.values, {
    email: 'person@example.test',
    age: 16,
    roles: ['buyer', 'owner'],
    password: 'secret',
    confirmation: 'different',
  })
  assert.deepEqual(result.dropped, ['admin'])
  assert.deepEqual(
    result.issues.map((issue) => [issue.field, issue.code]),
    [
      ['admin', 'unknown'],
      ['age', 'min'],
      ['roles', 'one_of'],
      ['password', 'min_length'],
      ['confirmation', 'confirmation'],
    ],
  )
  assert.equal(result.fieldErrors.confirmation![0]!.messageKey, 'signup.passwordConfirmation')
  assert.deepEqual(result.formErrors, [])
})

test('form validation: optional blanks are omitted and repeated FormData entries are preserved', () => {
  const raw = valuesFromFormData([
    ['tag', 'one'],
    ['tag', 'two'],
    ['note', ''],
  ])
  assert.deepEqual(raw, { tag: ['one', 'two'], note: '' })

  const result = validateForm(
    defineFormSchema<{ tag: string[]; note?: string }>({
      fields: {
        tag: { type: 'text', multiple: true, required: true, minLength: 2 },
        note: { type: 'text' },
      },
    }),
    raw,
  )
  assert.equal(result.valid, true)
  assert.deepEqual(result.values, { tag: ['one', 'two'] })
})

test('form validation: hostile control names remain ordinary own properties', () => {
  const raw = valuesFromFormData([
    ['__proto__', 'held'],
    ['constructor', 'also-held'],
  ])
  assert.equal(Object.getPrototypeOf(raw), Object.prototype)
  assert.equal(Object.hasOwn(raw, '__proto__'), true)
  assert.equal(Reflect.get(raw, '__proto__'), 'held')

  const result = validateForm(defineFormSchema({ fields: {}, unknown: 'reject' }), raw)
  assert.deepEqual(result.dropped.sort(), ['__proto__', 'constructor'])
  assert.equal(Object.hasOwn(result.fieldErrors, '__proto__'), true)
  assert.equal(Object.getPrototypeOf(result.fieldErrors), Object.prototype)
})

test('form validation: browser strings cast through every scalar boundary', () => {
  const schema = defineFormSchema<{
    count: number
    ratio: number
    amount: string
    active: boolean
    dueOn: string
    startsAt: string
    settings: unknown
  }>({
    fields: {
      count: { type: 'int', required: true },
      ratio: { type: 'float', required: true, max: 1 },
      amount: { type: 'decimal', required: true },
      active: { type: 'bool', required: true, oneOf: [true] },
      dueOn: { type: 'date', required: true },
      startsAt: { type: 'datetime', required: true },
      settings: { type: 'json', required: true },
    },
  })
  const valid = validateForm(schema, {
    count: '2',
    ratio: '0.5',
    amount: 1e-7,
    active: 'on',
    dueOn: '2028-02-29',
    startsAt: '2028-02-29T08:30:00Z',
    settings: '{"compact":true}',
  })
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.values, {
    count: 2,
    ratio: 0.5,
    amount: '0.0000001',
    active: true,
    dueOn: '2028-02-29',
    startsAt: '2028-02-29T08:30:00Z',
    settings: { compact: true },
  })

  const invalid = validateForm(schema, {
    count: '2.5',
    ratio: '2',
    amount: '1e3',
    active: 'false',
    dueOn: '2027-02-29',
    startsAt: 'not-a-date',
    settings: '{bad json}',
  })
  assert.deepEqual(
    invalid.issues.map((issue) => [issue.field, issue.code]),
    [
      ['count', 'type'],
      ['ratio', 'max'],
      ['amount', 'type'],
      ['active', 'one_of'],
      ['dueOn', 'type'],
      ['startsAt', 'type'],
      ['settings', 'type'],
    ],
  )
})

test('form state: touched, dirty, submit and server issues have one predictable lifecycle', async () => {
  const form = createForm(signup, {})
  assert.equal(form.valid(), false)
  assert.deepEqual(form.errors('email'), [], 'untouched errors stay hidden')

  form.touch('email')
  assert.equal(form.errors('email')[0]!.code, 'required')
  form.set('email', 'person@example.test')
  assert.equal(form.errors('email').length, 0)
  assert.equal(form.dirty(), true)

  let called = false
  const blocked = await form.submit(() => {
    called = true
  })
  assert.equal(blocked.ok, false)
  assert.equal(called, false)
  assert.equal(form.errors('age')[0]!.code, 'required', 'submit reveals every field error')

  form.set('age', '25')
  form.set('roles', ['buyer'])
  form.set('password', 'long-enough')
  form.set('confirmation', 'long-enough')
  const submitted = await form.submit(async (values) => {
    assert.equal(form.submitting(), true)
    const age: number = values.age
    return age
  })
  assert.deepEqual(submitted, { ok: true, value: 25 })
  assert.equal(form.submitting(), false)

  form.applyServerIssues([validationIssue(null, 'conflict', 'signup.conflict')])
  assert.equal(form.formErrors()[0]!.code, 'conflict')
  form.reset()
  assert.equal(form.dirty(), false)
  assert.equal(form.submitted(), false)
  form.dispose()
})

test('form validation: server helpers throw or return the same HTTP 422 problem shape', () => {
  const result = validateForm(signup, {})
  assert.throws(
    () => assertForm(signup, {}),
    (error: unknown) => {
      assert.ok(error instanceof FormValidationError)
      assert.equal(error.code, 'E_FORM_INVALID')
      assert.equal(error.fieldErrors.email![0]!.code, 'required')
      return true
    },
  )

  const response = invalidForm(result)
  assert.equal(response.status, 422)
  const problem = JSON.parse(String(response.body))
  assert.equal(problem.ok, false)
  assert.equal(problem.code, 'E_FORM_INVALID')
  assert.equal(problem.fieldErrors.email[0].messageKey, 'validation.required')

  assert.deepEqual(issuesFromFieldErrors([{ field: 'name', message: 'is required' }]), [
    {
      field: 'name',
      code: 'invalid',
      messageKey: 'validation.invalid',
      params: { message: 'is required' },
    },
  ])
})
