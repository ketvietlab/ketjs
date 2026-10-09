# Browser form comparison

An independently installed, private benchmark deployment for the current KetJS form session and
native adapter. React 19.3.0, React Hook Form 7.89.0 and Formik 2.4.9 are pinned in this directory's
lockfile. They are not dependencies of any published framework package.

## Run

The framework's emitted artifacts must match the checkout. The root build compiles all five
framework packages; it does not run any test suite. Install and build the benchmark separately.

```bash
# Run from: ketjs/
npm run build
npm ci --prefix bench/form-comparison --ignore-scripts
node --test bench/form-comparison/workload.test.mjs
npm start --prefix bench/form-comparison
```

Open `http://127.0.0.1:39751/` in Chromium and click **Run benchmark**. Keep the page active and
avoid concurrent CPU-heavy work. `FORM_BENCH_PORT` can select another loopback port. Stop the server
afterwards. A completed run saves timestamped raw JSON and `form-comparison-latest.json` under the
ignored `.artifacts/benchmarks/` directory. The raw reports are not committed or published by the
documentation site. The maintained summary lives in
[the benchmark guide](../../packages/docs/content/docs/benchmarks.md#browser-form-sessions).

## Equivalent edit workload

- Flat forms contain 10, 100 or 500 independent required text controls.
- Nested forms contain 10, 100 or 250 variant rows: a stable key, nullable record ID, decimal weight,
  boolean active flag and attribute-value record. Each row exposes three controls, plus one title
  control: 31, 301 or 751 controls. Editing a middle-row weight preserves its other properties.
- All libraries use the same `defineFormContract`/`validateForm` engine on every input change.
  Every field has a value mirror and error text, and the form has dirty/error/pending status. This
  measures the form library plus the same schema, not each library's built-in rule validator.
- React uses a minified production build, without StrictMode. RHF uses uncontrolled `register`,
  per-field `useWatch` and exact `useFormState` subscriptions, and memoized field components.
  Formik uses memoized field groups and `FastField`. Nested fixtures initialize real `useFieldArray`
  and `FieldArray`; Formik's array wrapper disables its additional validation pass while the form's
  `validateOnChange` remains enabled. Independent fields make `FastField` appropriate here.
- KetJS uses its native adapter. Flat forms use its default reader, writer and issue lookup.
  Nested forms use an explicit structured reader, equality-guarded writer and a pre-indexed
  `control(issue)` lookup. All KetJS field mirrors use primitive `computed` selectors over the
  whole `session.values()` signal and effects writing existing native nodes. It does not render
  a TSX component tree on each edit. The custom nested adapter is consumer code, not a claim about
  the default adapter's nested-path support.

The subscription setup follows the official RHF
[useWatch](https://github.com/react-hook-form/documentation/blob/master/src/content/docs/usewatch.mdx)
and [useFormState](https://github.com/react-hook-form/documentation/blob/master/src/content/docs/useformstate.mdx)
contracts and Formik's [FastField](https://formik.org/docs/api/fastfield) contract.

## Measurements and correctness

Each case has two fresh mounts, with five warmup edits per mount. Library order rotates by case
and mount. Each mount measures twenty valid edits, five invalid/recovery pairs, and five API
submits. A completed run therefore has 40 valid-edit samples and 10 samples for each other
operation per library/workload. Run in multiple fresh browser sessions to check repeatability;
pool samples only when runtime/harness digests, versions, viewport and method match.

Edits change the input with the original native value setter, bypassing React's value tracker,
then dispatch a bubbling synthetic `input` event. The driver value assignment and the preceding
animation-frame wait are excluded. Two clocks are recorded: synchronous event dispatch and
elapsed time until raw state, dirty state, error text and the field's value-mirror DOM have
settled. MessageChannel polling lets React commit asynchronous work. The latter is the primary
comparison; dispatch time alone would exclude part of React's work.

After each measurement, assertions verify the validation outcome, dirty state and an unrelated
value. Each submit checks the entire accepted projection and new baseline. Assertions and UI
reporting are outside timed regions. Failure aborts the run and prevents saving a passed report.
The four focused Node tests check fixture validation, structured issue paths, normalization,
instrumentation and percentile calculations.

API submit includes validation, a mock accepted receipt and baseline reset. KetJS also locks
native controls, snapshots mutation identity and checks its receipt. RHF calls `handleSubmit`
and `reset`; Formik calls `submitForm`, projects the accepted values through the shared schema
and calls `resetForm`. These are application flows with different library semantics, not a
comparison of equally capable server transactions. There is no HTTP or database in this timer.

Render and DOM counters use separate fresh diagnostic mounts, never timed mounts. Wrappers are
installed before React mounts so its native input tracker sees them. The counters distinguish:

- Field-view executions, executions for unedited fields, form/status renders, KetJS selector reads
  and native adapter effects. A signal effect and a React render are different operations.
- Successful custom validation-rule calls and completed root refinements. Built-in validation
  also costs time; a malformed structured child can skip a root refinement, so that counter does
  not represent all validation attempts.
- Input `value` setter calls, disabled-property writes, attribute method calls, text setter calls
  and actual MutationObserver records. Calls can write unchanged values; fewer records do not
  mean the rest of the adapter did no work. React can update `defaultValue` or attributes without
  assigning `input.value`; the value-write counter alone does not describe all DOM work.

A separate 100-field KetJS probe removes the primitive `computed` selectors and reads
`session.values()` inside each field effect, exposing the cost of coarse subscriptions.

## Limits

This is a synthetic desktop Chromium workload, not a KetSuite deployment, typing/IME test,
production capacity estimate, browser-paint/INP measurement or a universal library ranking.
Timer resolution and background activity affect sub-millisecond samples. No CPU throttling,
Safari, mobile, memory/GC profiling, mount/hydration, array append/remove/reorder, dense errors,
async business validation or cross-field dependency graph is measured. These require their own
workloads before making corresponding claims. Published results must identify the runtime
revision, environment, package versions, sample counts and remaining gaps.
