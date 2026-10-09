import { memo, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Formik, FastField, FieldArray, useFormikContext } from 'formik'
import { useForm, useFormState, useWatch, useFieldArray } from 'react-hook-form'
import { attachForm, computed, createFormSession, effect } from '../../packages/ketjs-view/dist/index.js'
import { errorsOf, get, put } from './workload.mjs'
import { countField } from './trace.mjs'

const task = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
export async function until(check, label) {
  const limit = performance.now() + 5000
  while (!check()) {
    if (performance.now() > limit) throw new Error(`did not settle: ${label}`)
    await task()
  }
}

function nativeForm(host, spec) {
  const form = document.createElement('form')
  form.noValidate = true
  const elements = new Map()
  for (const field of spec.controls) {
    const label = document.createElement('label')
    label.textContent = field.name
    const input = document.createElement('input')
    input.name = field.name
    input.type = field.type
    const error = document.createElement('span')
    error.dataset.formError = field.name
    const mirror = document.createElement('output')
    mirror.dataset.value = field.name
    label.append(input, error, mirror)
    form.append(label)
    elements.set(field.name, { input, error, mirror })
  }
  const status = document.createElement('output')
  status.dataset.status = ''
  form.append(status)
  host.append(form)
  return { form, elements, status }
}

export async function mountKet(host, spec, metrics, broad = false) {
  const { form, elements, status } = nativeForm(host, spec)
  const session = createFormSession(spec.contract, {
    initial: spec.initial,
    recordId: 'p1',
    revision: 'r0',
    transport: async (input) => ({
      status: 'committed',
      accepted: structuredClone(input.values),
      revision: 'r1',
      value: null,
    }),
  })
  const options = { formatIssue: (issue) => issue.code }
  if (spec.kind === 'nested') {
    options.read = () => {
      const values = structuredClone(session.values())
      for (const field of spec.controls) {
        const input = elements.get(field.name).input
        put(values, field.name, field.type === 'checkbox' ? input.checked : input.value)
      }
      return values
    }
    options.write = (_, values) => {
      for (const field of spec.controls) {
        const input = elements.get(field.name).input
        const value = get(values, field.name)
        if (field.type === 'checkbox') {
          if (input.checked !== value) input.checked = value
        } else if (input.value !== value) input.value = value
      }
    }
    options.control = (issue) => elements.get(issue.field)?.input ?? null
  }
  const detach = attachForm(form, session, options)
  const dispose = []
  for (const field of spec.controls) {
    const select = () => {
      if (metrics.enabled) metrics.derivedReads++
      return get(session.values(), field.name)
    }
    const held = broad ? select : computed(select)
    dispose.push(
      effect(() => {
        const value = held()
        countField(metrics, field.name, spec.target)
        elements.get(field.name).mirror.textContent = String(value)
      }),
    )
    if (!broad) dispose.push(() => held.dispose())
  }
  dispose.push(
    effect(() => {
      if (metrics.enabled) metrics.statusRenders++
      status.textContent = `${session.dirty()} / ${session.issues().length > 0} / ${session.locked()}`
    }),
  )
  return {
    values: () => session.values(),
    error: (name) => session.errors(name, false)[0]?.code,
    busy: () => session.locked(),
    dirty: () => session.dirty(),
    touch: (name) => session.touch(name),
    submit: async () => {
      const result = await session.submit()
      if (result.status !== 'committed') throw new Error(`KetJS refused: ${result.status}`)
      return result.accepted
    },
    dispose: async () => {
      detach()
      for (const stop of dispose) stop()
      session.dispose()
      host.replaceChildren()
    },
  }
}

const RHFField = memo(function RHFField({ methods, field, spec, metrics }) {
  const value = useWatch({ control: methods.control, name: field.name, exact: true })
  const { errors } = useFormState({ control: methods.control, name: field.name, exact: true })
  countField(metrics, field.name, spec.target)
  return (
    <label>
      {field.name}
      <input type={field.type} {...methods.register(field.name)} />
      <span data-form-error={field.name}>{get(errors, field.name)?.message ?? ''}</span>
      <output data-value={field.name}>{String(value)}</output>
    </label>
  )
})
const RHFFields = memo(function RHFFields(props) {
  return props.spec.controls.map((field) => <RHFField key={field.name} {...props} field={field} />)
})
function RHFArrayFields(props) {
  const { fields } = useFieldArray({ control: props.methods.control, name: 'variants', keyName: 'formKey' })
  if (fields.length !== props.spec.size) throw new Error('incorrect RHF field array size')
  return <RHFFields {...props} />
}
function RHFStatus({ methods, metrics, api }) {
  const state = useFormState({ control: methods.control })
  const { isDirty, errors, isSubmitting } = state
  api.state = { isDirty, errors, isSubmitting }
  if (metrics.enabled) metrics.statusRenders++
  return <output data-status>{`${isDirty} / ${Object.keys(errors).length > 0} / ${isSubmitting}`}</output>
}
function RHFForm({ spec, metrics, api }) {
  const methods = useForm({
    defaultValues: spec.initial,
    mode: 'onChange',
    resolver: (values) => {
      const result = spec.validate(values)
      return { values: result.valid ? result.values : {}, errors: errorsOf(result.issues, true) }
    },
  })
  if (metrics.enabled) metrics.formRenders++
  api.methods = methods
  useEffect(() => {
    api.ready = true
  }, [api])
  return (
    <form noValidate>
      {spec.kind === 'nested' ? (
        <RHFArrayFields methods={methods} spec={spec} metrics={metrics} />
      ) : (
        <RHFFields methods={methods} spec={spec} metrics={metrics} />
      )}
      <RHFStatus methods={methods} metrics={metrics} api={api} />
    </form>
  )
}
export async function mountRHF(host, spec, metrics) {
  const root = createRoot(host)
  const api = { ready: false }
  root.render(<RHFForm spec={spec} metrics={metrics} api={api} />)
  await until(() => api.ready, 'RHF mount')
  return {
    values: () => api.methods.getValues(),
    error: (name) => get(api.state.errors, name)?.message,
    busy: () => api.state.isSubmitting,
    dirty: () => api.state.isDirty,
    touch: () => {},
    submit: async () => {
      let accepted
      await api.methods.handleSubmit(
        async (values) => {
          accepted = structuredClone(values)
          await Promise.resolve()
          api.methods.reset(accepted)
        },
        () => {
          throw new Error('RHF submit refused')
        },
      )()
      return accepted
    },
    dispose: async () => {
      root.unmount()
      await task()
      host.replaceChildren()
    },
  }
}

const FormikFields = memo(function FormikFields({ spec, metrics }) {
  return spec.controls.map((field) => (
    <FastField key={field.name} name={field.name} type={field.type}>
      {({ field: binding, meta }) => {
        countField(metrics, field.name, spec.target)
        return (
          <label>
            {field.name}
            <input
              {...binding}
              type={field.type}
              checked={field.type === 'checkbox' ? Boolean(binding.value) : undefined}
            />
            <span data-form-error={field.name}>{meta.error ?? ''}</span>
            <output data-value={field.name}>{String(binding.value)}</output>
          </label>
        )
      }}
    </FastField>
  ))
})
function FormikStatus({ api, metrics }) {
  const state = useFormikContext()
  api.state = state
  useEffect(() => {
    api.ready = true
  }, [api])
  if (metrics.enabled) metrics.statusRenders++
  return (
    <output
      data-status
    >{`${state.dirty} / ${Object.keys(state.errors).length > 0} / ${state.isSubmitting}`}</output>
  )
}
export async function mountFormik(host, spec, metrics) {
  const root = createRoot(host)
  const api = { ready: false }
  root.render(
    <Formik
      initialValues={spec.initial}
      validateOnChange
      validateOnBlur={false}
      validate={(values) => errorsOf(spec.validate(values).issues)}
      onSubmit={async (values, helpers) => {
        api.accepted = structuredClone(spec.validate(values).values)
        await Promise.resolve()
        helpers.resetForm({ values: api.accepted })
      }}
    >
      {() => {
        if (metrics.enabled) metrics.formRenders++
        return (
          <form noValidate>
            {spec.kind === 'nested' ? (
              <FieldArray name="variants" validateOnChange={false}>
                {() => <FormikFields spec={spec} metrics={metrics} />}
              </FieldArray>
            ) : (
              <FormikFields spec={spec} metrics={metrics} />
            )}
            <FormikStatus api={api} metrics={metrics} />
          </form>
        )
      }}
    </Formik>,
  )
  await until(() => api.ready, 'Formik mount')
  return {
    values: () => api.state.values,
    error: (name) => get(api.state.errors, name),
    busy: () => api.state.isSubmitting || api.state.isValidating,
    dirty: () => api.state.dirty,
    touch: () => {},
    submit: async () => {
      await api.state.submitForm()
      return api.accepted
    },
    dispose: async () => {
      root.unmount()
      await task()
      host.replaceChildren()
    },
  }
}

export const libraries = [
  { name: 'KetJS session + native adapter', mount: mountKet },
  { name: 'React Hook Form + isolated subscriptions', mount: mountRHF },
  { name: 'Formik FastField', mount: mountFormik },
]
