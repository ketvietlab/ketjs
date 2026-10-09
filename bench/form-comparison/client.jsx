import { libraries, mountKet, until } from './adapters.jsx'
import { get, stats, workload } from './workload.mjs'
import { counters, resetCounters, trace } from './trace.mjs'

const plan = [
  ['flat', 10],
  ['flat', 100],
  ['flat', 500],
  ['nested', 10],
  ['nested', 100],
  ['nested', 250],
]
const trials = 2
const edits = 20
const transitions = 5
const submits = 5
const host = document.querySelector('#fixture')
const progress = document.querySelector('#progress')
const run = document.querySelector('#run')
const nativeSetValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
let checks = 0

function controls(spec) {
  const form = host.querySelector('form')
  const byName = new Map(Array.from(form.querySelectorAll('input')).map((input) => [input.name, input]))
  const mirrors = new Map(
    Array.from(form.querySelectorAll('[data-value]')).map((node) => [node.dataset.value, node]),
  )
  const errors = new Map(
    Array.from(form.querySelectorAll('[data-form-error]')).map((node) => [node.dataset.formError, node]),
  )
  assert(byName.size === spec.controls.length, 'incorrect mounted control count')
  return { input: byName.get(spec.target), mirrors, errors, byName }
}

async function edit(adapter, spec, nodes, value, invalid = false) {
  // Native typing changes the value outside React's own per-element tracker.
  // Do this before timing and bypass diagnostic setters to exclude the driver.
  nativeSetValue.call(nodes.input, value)
  const start = performance.now()
  nodes.input.dispatchEvent(new Event('input', { bubbles: true }))
  const dispatched = performance.now()
  await until(
    () =>
      get(adapter.values(), spec.target) === value &&
      nodes.mirrors.get(spec.target).textContent === value &&
      Boolean(nodes.errors.get(spec.target).textContent) === invalid &&
      adapter.dirty() &&
      !adapter.busy(),
    'edit',
  )
  const settled = performance.now()
  assert(Boolean(adapter.error(spec.target)) === invalid, 'incorrect validation result')
  assert(adapter.dirty(), 'edit did not mark the draft dirty')
  assert(
    get(adapter.values(), spec.controls[0].name) === get(spec.initial, spec.controls[0].name),
    'unrelated value changed',
  )
  checks += 3
  return { dispatchMs: dispatched - start, settledMs: settled - start }
}

async function withMount(library, kind, size, callback, counting = false, broad = false) {
  const metrics = counters()
  const spec = workload(kind, size, metrics)
  const observer = counting ? trace(host, metrics) : null
  let adapter
  try {
    adapter = await (broad ? mountKet(host, spec, metrics, true) : library.mount(host, spec, metrics))
    const nodes = controls(spec)
    adapter.touch(spec.target)
    for (let n = 0; n < 5; n++) {
      await frame()
      await edit(adapter, spec, nodes, spec.validValue(n))
    }
    await frame()
    observer?.drain()
    resetCounters(metrics)
    return await callback({ adapter, spec, nodes, metrics, observer })
  } finally {
    metrics.enabled = false
    if (adapter) await adapter.dispose()
    observer?.stop()
  }
}

async function timingTrial(library, kind, size) {
  return withMount(library, kind, size, async ({ adapter, spec, nodes }) => {
    const valid = [],
      dispatch = [],
      invalid = [],
      recovery = [],
      submit = []
    for (let n = 0; n < edits; n++) {
      await frame()
      const held = await edit(adapter, spec, nodes, spec.validValue(10 + n))
      valid.push(held.settledMs)
      dispatch.push(held.dispatchMs)
    }
    for (let n = 0; n < transitions; n++) {
      await frame()
      invalid.push((await edit(adapter, spec, nodes, spec.invalidValue, true)).settledMs)
      await frame()
      recovery.push((await edit(adapter, spec, nodes, spec.validValue(40 + n))).settledMs)
    }
    for (let n = 0; n < submits; n++) {
      await frame()
      await edit(adapter, spec, nodes, spec.validValue(60 + n))
      const expected = spec.validate(adapter.values()).values
      const start = performance.now()
      const accepted = await adapter.submit()
      await until(() => !adapter.busy() && !adapter.dirty(), 'accepted baseline')
      submit.push(performance.now() - start)
      assert(JSON.stringify(accepted) === JSON.stringify(expected), 'incorrect accepted projection')
      assert(JSON.stringify(adapter.values()) === JSON.stringify(expected), 'incorrect accepted baseline')
      checks += 2
    }
    return { valid, dispatch, invalid, recovery, submit }
  })
}

async function countingTrial(library, kind, size, broad = false) {
  return withMount(
    library,
    kind,
    size,
    async ({ adapter, spec, nodes, metrics, observer }) => {
      const result = {}
      for (const [state, value, invalid] of [
        ['valid', spec.validValue(10), false],
        ['invalid', spec.invalidValue, true],
        ['recovery', spec.validValue(11), false],
      ]) {
        observer.drain()
        resetCounters(metrics)
        metrics.enabled = true
        await edit(adapter, spec, nodes, value, invalid)
        observer.drain()
        result[state] = Object.fromEntries(Object.entries(metrics).filter(([key]) => key !== 'enabled'))
        metrics.enabled = false
        await frame()
      }
      return result
    },
    true,
    broad,
  )
}

function row(result) {
  const tr = document.createElement('tr')
  for (const text of [
    `${result.kind} ${result.size} (${result.controls} inputs)`,
    result.library,
    result.timings.valid.medianMs.toFixed(2),
    result.timings.valid.p95Ms.toFixed(2),
    result.timings.invalid.medianMs.toFixed(2),
    result.timings.submit.medianMs.toFixed(2),
    result.counts.valid.fieldRenders,
    result.counts.valid.uneditedFieldRenders,
    result.counts.valid.valueWrites,
    result.counts.valid.domMutationRecords,
  ]) {
    const td = document.createElement('td')
    td.textContent = String(text)
    tr.append(td)
  }
  document.querySelector('#results').append(tr)
}

async function benchmark() {
  run.disabled = true
  checks = 0
  document.querySelector('#results').replaceChildren()
  const report = {
    metadata: window.benchmarkMetadata,
    browser: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio },
    startedAt: new Date().toISOString(),
    method: {
      trials,
      warmupEditsPerMount: 5,
      editsPerTrial: edits,
      transitionsPerTrial: transitions,
      submitsPerTrial: submits,
      syntheticInput: true,
      throttling: 'none',
      production: true,
      timing:
        'input event dispatch through state, error and value-mirror DOM settlement; excludes layout and paint',
      submit: 'client validation plus mock accepted receipt and baseline reset; no HTTP or database',
      counters: 'separate fresh mounts with prototype wrappers and MutationObserver; not used for timings',
    },
    results: [],
  }
  try {
    for (let c = 0; c < plan.length; c++) {
      const [kind, size] = plan[c]
      const collected = libraries.map((library) => ({
        library: library.name,
        kind,
        size,
        controls: kind === 'flat' ? size : 1 + 3 * size,
        samples: { valid: [], dispatch: [], invalid: [], recovery: [], submit: [] },
        trials: [],
      }))
      for (let t = 0; t < trials; t++)
        for (let step = 0; step < libraries.length; step++) {
          const index = (c + t + step) % libraries.length
          progress.textContent = `Running ${kind} ${size}: ${libraries[index].name}, mount ${t + 1}/${trials}`
          await frame()
          const measured = await timingTrial(libraries[index], kind, size)
          collected[index].trials.push(measured)
          for (const key of Object.keys(measured)) collected[index].samples[key].push(...measured[key])
        }
      for (let index = 0; index < libraries.length; index++) {
        progress.textContent = `Counting ${kind} ${size}: ${libraries[index].name}`
        await frame()
        const result = collected[index]
        result.counts = await countingTrial(libraries[index], kind, size)
        result.timings = Object.fromEntries(
          Object.entries(result.samples).map(([key, samples]) => [key, stats(samples)]),
        )
        delete result.samples
        report.results.push(result)
        row(result)
      }
    }
    progress.textContent = 'Counting KetJS broad values() subscriptions at 100 fields'
    report.broadSubscriptionProbe = await countingTrial(libraries[0], 'flat', 100, true)
    report.finishedAt = new Date().toISOString()
    report.correctnessChecks = checks
    report.status = 'passed'
    const response = await fetch('/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    })
    if (!response.ok) throw new Error(`report save failed: ${response.status}`)
    const saved = await response.json()
    progress.textContent = `Completed: ${report.results.length} cases; ${checks} correctness checks; saved ${saved.path}`
    window.benchmarkResult = report
  } catch (error) {
    progress.textContent = `Failed (${progress.textContent}): ${error.message}`
    console.error(error)
    window.benchmarkError = String(error.stack ?? error)
  } finally {
    run.disabled = false
  }
}

run.addEventListener('click', benchmark)
