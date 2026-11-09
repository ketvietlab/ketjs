---
name: ketjs
description: How to write application code on KetJS one way — functions (defineFn, effects, returns, idempotency, dry-run, company reach), results and errors, transactions, company and branch scope, permissions, decimals, time, jobs, HTTP responses, browser state (islands, stores, Mirror, form sessions, behaviors), module composition and tests. Use before writing or reviewing KetJS functions, jobs, routes, models or module wrappers in any KetJS consumer, including KetSuite.
---

# Writing code on KetJS

This skill is about **how** application code uses KetJS. It does not replace the consumer's own
repository rules. When sources disagree, the order is:

1. the nearest `AGENTS.md`;
2. the KetJS documentation **for the version the consumer runs**;
3. this skill;
4. the code around you.

The code around you is the weakest guide. A large consumer accumulates one local helper per module
for the same need: refusal results, rollback errors, company filters, clocks. Copying the nearest file
multiplies those variants. Follow the sections below instead.

## 0. Read the documentation before you write — this is not optional

The sections below summarize; they do not replace the documentation. Before you write or review code,
**read in full** every page that the task touches, for the version the consumer runs. Name the pages
you read in the pull request description. A change whose author cannot name the pages is not ready.

- The version is the `@ketvietlab/ketjs` and `@ketvietlab/ketjs-view` versions installed in the consumer
  (`node_modules/@ketvietlab/ketjs/package.json`). Do not use an API that only exists in a newer release.
- The npm packages ship `dist` only, not the documentation. Read each release's pages from this
  repository at the release tag, cloning it if the consumer machine has no checkout:

  ```bash
  # Run from: /path/to/ketjs
  git fetch --tags origin
  git show v0.6.2:packages/docs/content/docs/functions.md
  ```

  https://ketjs.dev serves the latest published release, which may be ahead of the consumer.
- **Always read** for any change that writes data: `functions.md`, `data.md`, `models.md`, `authorization.md`.
- **Always read** for any change to browser code (islands, client scripts, forms, behaviors):
  `rendering.md`, `view-effects-data.md`, `view-forms.md`, `form-actions.md`, `form-validation.md`,
  and, where the installed ketjs-view has them, `view-stores.md` and `view-mirror.md`.
- **When the KetJS version changes:** read `upgrading.md` and `release-notes.md` for every version
  between the old and the new one.
- If the task matches no row below, read `index.md` and `api.md` to find the page. Do not guess.

| Area | Pages |
| --- | --- |
| Setup and layout | `index.md`, `quick-start.md`, `project-structure.md`, `configuration.md`, `cli-config.md` |
| Composition | `modules.md`, `module-discovery.md`, `workspaces.md` |
| Functions and requests | `functions.md`, `request-lifecycle.md`, `http.md`, `openapi.md` |
| Forms | `form-actions.md`, `form-validation.md`, `view-forms.md` |
| Data | `data.md`, `models.md`, `migrations.md` |
| Identity and access | `authorization.md`, `sessions-tenants.md`, `auth-starter.md` |
| Rendering and browser state | `rendering.md`, `view-effects-data.md`, `view-stores.md`, `view-mirror.md`, `view-static-sites.md` |
| Presentation | `themes.md`, `menus-i18n.md`, `reports.md` |
| Runtime services | `jobs.md`, `integrations.md`, `logging.md` |
| Verify and deploy | `testing.md`, `deployment.md`, `benchmarks.md` |
| Reference and evolution | `api.md`, `architecture-decisions.md`, `upgrading.md`, `release-notes.md`, `open-questions.md` |
| Working on KetJS itself, not a consumer | `contributing.md`, `releasing.md`, `module-installation-plan.md` |

## 1. One helper per need, per consumer

- A consumer keeps **one** shared helper for each recurring need: building a refusal result, rolling
  back a refused transaction, filtering reads to the write company, building company-qualified keys,
  and reading the current time. Put them in one place the consumer's modules already depend on.
- Before you write `const invalid = …`, `class Refused extends Error`, `const now = …` or a company
  filter inside a module, search the consumer for the shared one and import it. If none exists yet,
  say so in the pull request instead of adding another variant.
- Converting old code is the consumer's decision. Change what you touch and leave a repository-wide
  rewrite to an agreed plan.

## 2. Functions

- Declare functions with `defineFn({ … })`, with a named handler that tests can import.
- Declare `input`, `output` and `returns`:
  - Without `output`, the permission inventory marks the response as unprojected.
  - Without `returns`, nothing checks how many rows come back, and HTTP function bindings require it.
- `effects` must be complete and minimal. Include every model a called helper reads, every model a
  `where` condition or preload refers to, and every job enqueued (`enqueue:module.job`). When a shared
  helper has fixed reach, export its effects as a constant and spread it, so the list is not copied by hand.
- `idempotent: true` means the framework claims the caller's key, stores the first result and replays it.
  The caller must supply a **stable business key**, because random retry keys defeat deduplication.
  A claim older than five minutes is taken over, so an operation that can run longer must be a job, or
  must check the business record it is about to create before creating it.
- A handler that accepts a caller-chosen id and answers "already exists" with the stored row must first
  check that the row belongs to the same parent record and the same company. Otherwise a replay with a
  different parent receives another document's data.
- Declare `dryRun: true` only when the handler causes no side effect while `ctx.dryRun` is true:
  no provider call, no mail, no storage write.
- `crossCompany: true` is for deliberate consolidation or shared reporting only. Leave a comment
  saying why.
- `agent: true` and `anonymous: true` are exposure decisions, not defaults. Use `exposure: 'internal'`
  when an owned route must handle rate limiting, origin checks, cookies or response shaping.

## 3. Results and errors

KetJS already separates three kinds of failure:

| Failure | What happens |
| --- | --- |
| The input does not match the signature | The runtime refuses before the handler runs: `422 E_INVALID_INPUT` with `issues`/`fieldErrors`. Do not re-check types in the handler. |
| The current state prevents the operation | Throw `new KetError({ code: 'E_CONFLICT', message, module, hint, at })`. The transport answers `409`. |
| A defect: a broken invariant or an impossible state | Throw an ordinary `Error` and let it surface. |

For a domain refusal that is not a conflict (a rule says no), write it one way:

- **Before anything is written:** return the consumer's single refusal shape, with a field and a
  **stable code that is a message key**, never an English sentence. Screens can translate codes and
  tests can assert them; prose can be neither.
- **After the transaction has written:** returning from inside `ctx.tx` commits the partial work.
  Throw the consumer's shared refusal error inside the transaction, catch it outside, and return its result.
- Domain validation of fields belongs in changesets (`ctx.change(...).cast(...).required(...)`), not in
  hand-written checks.
- Never leave a `catch {}` empty. When an external system fails, separate "certainly not done" from
  "unknown" (a timeout, a 5xx, a dropped connection). An unknown outcome must be checked against the
  provider before any retry, never treated as a failure and resent.

## 4. Transactions and concurrency

- Keep all writes of one business operation in one `ctx.tx()`. Inside the callback, use `tx` for every
  read and write.
- Re-read inside the transaction whatever the decision depends on. A row read before the transaction
  may already be stale.
- When a document carries a revision, claim it at the start of the transaction (compare-and-set). If the
  claim loses, refuse with `E_CONFLICT`; never overwrite.
- Do not nest transactions, and do not call HTTP or other external systems inside one.
- Enqueue jobs caused by the operation through `tx.jobs.enqueue()`, so a rollback removes both the rows
  and the job.
- KetJS has no model write hooks. To act after every write to a model, wrap every function whose
  effects include `write:<model>` and read `ctx.writes` after the handler. A deployment can only wrap a
  module it composes as an object, not one listed by name.

## 5. Company and branch scope

- A deployment that holds several legal entities declares `companies: true`. Every model then chooses
  `shared`, `company` or `company+branch`; there is no default.
- `companyId` and `branchId` are reserved, stamped on insert and immutable. Never declare them on a
  scoped model and never patch them.
- **Reads span `scope.companies`; writes go to exactly one `scope.company`.** Consequences:
  - A list or lookup whose result becomes a reference on a new row must be filtered to the write
    company. Otherwise a user who can see two companies attaches the other company's customer,
    warehouse or account to this company's document.
  - Reload every id the caller sends (partner, warehouse, journal, account, tax) through the shared
    company filter before using it. `ctx.db.select(model, { id })` alone is not enough.
  - Ids are unique across the tenant database, not per company. A row keyed by a constant (a sequence,
    a settings row) must put the company in its key.
- Test with at least two companies whenever the deployment has them.

## 6. Permissions

- Grants name **operations** (function keys), not models: `sales.listOrders` does not grant another
  function that reads `sales.Order`.
- Hiding a button is not an authorization boundary. Server behavior enforces permissions and scope.
- In routes, `ServeContext.live(req)` is the same manifest for every viewer. It says whether a function
  exists, not whether this viewer may call it. To show or hide a command, check both:
  `Boolean(live.functions[key]) && await ctx.allows(key, url, req)`.
- Put sensitive reads (cost, margin, salary) behind their own function so they can be granted separately.
- Test denial as well as success, with a role that really lacks the grant, not with a superuser.

## 7. Decimals, money and quantities

- Money and quantities are `decimal` fields, which hold **exact strings**. Keep them as strings across
  the round trip.
- Never use `Number()`, `parseFloat`, `toFixed`, or `+`, `-`, `*` on floating values for money or
  quantities. Use the consumer's exact decimal helper (integer minor units on `BigInt` at the currency
  scale). `String()` of a float can even produce exponent notation.
- Round once per document. Derive the document total from its lines; do not compute it a second way.
- Decimal `sum`, `min` and `max` are exact on both adapters. An unrounded `avg` fails with
  `E_DECIMAL_AVG_ROUNDING_REQUIRED`, so round explicitly.
- Take document numbers from KetJS document sequences (see "Document numbers" in `data.md`). Whether
  numbering is gapless depends on whether you take the number inside the transaction.

## 8. Time

- Store instants as ISO 8601 UTC.
- Compute business dates (accounting date, due date, report period, expiry) in a **named** timezone,
  normally the company's. Never use the server's local timezone.
- Read the current time through the consumer's single clock helper, so tests can fix it.
- A schedule names its timezone (`KET_TIMEZONE` is only the default). The first tick after a schedule
  is installed does not fire, and ticks missed during downtime are skipped, not replayed.
- Run date tests with `TZ=UTC` as well. A development machine in UTC+7 hides off-by-one-day bugs.

## 9. Jobs

- Make handlers safe to run more than once. Derive external idempotency keys from stable business
  identity.
- Keep the input small: store payloads in models or storage, and enqueue references.
- Declare every data, enqueue, storage and transport effect. Check the abort signal during long work.
- `uniqueKey` coalesces **active** jobs with the same name and key in the same company. A job that
  re-enqueues itself with its own `uniqueKey` is merged into itself and the chain stops. Use a schedule
  for recurring work.
- Queue uniqueness prevents duplicate delivery; it does not replace business idempotency.
- A sweep job states which records it covers. When you add a new kind of record, check that the sweep
  sees it.

## 10. HTTP responses

- Answer with the response helpers. `text()`, `bytes()` and `streamed()` refuse markup types (HTML, SVG,
  XML, every `+xml`). Markup goes through `raw(value, { type })`, and you escape every value yourself.
- Build HTML through safe HTML. Never concatenate user data into markup.

## 11. Browser state: every piece of state has one owner

Browser code does not manage state freely. Every value the browser holds belongs to exactly one of the
owners below. If you cannot name its owner, stop and redesign before writing code.

| The state is | Its owner | Never |
| --- | --- | --- |
| Authorized data the first paint needs | The server handler, passed as plain-JSON island props | Fetching the same data again on mount |
| Server answers the browser reads or refreshes (lists, lookups, search results, details) | **Mirror** (`mirror.read`), keyed, with `parse` validating the payload | A hand-written `fetch` + signals cache, a module-level `Map`, a store task |
| A write to the server after a user action | **`mirror.write`** with `invalidates`/`optimistic`, or the form session for an edit | A bare `fetch` POST that forgets pending state, duplicate submits or refresh |
| A record or row set being edited until it is saved | **Form session** (`createFormSession` + `defineFormAction`, mounted with `attachForm`) | Hand-made dirty flags, a custom submit, closing on "the promise resolved" |
| A simple non-transactional form | `createForm` with one schema (`defineFormSchema`) | Re-implementing validation in the island |
| UI state of one island (selection, open panel, typed query) | Signals in the island closure; a **store** (`defineStore`) once there are many signals, many handlers or async work | Module-level variables, DOM attributes as the source of truth |
| State several islands share | The URL (server state through navigation), DOM events, or one browser Mirror passed in with a `scope` | A module singleton, a `window` global, a shared store |
| URL and history | The navigation runtime (`navigation.navigate`, `replace`, `reload`) | `history.pushState`, `history.replaceState`, `location.href =` |
| Document-wide wiring that spans several server-rendered regions | A **behavior** (`behaviors` in `defineModule`, with `when`) bound to its `lifetime` | Global listeners added from an island or at module top level |

Rules that hold in every case:

- **No module-level mutable state in browser code.** No top-level `let`, no top-level `Map`/`Set` cache,
  no top-level signal or store. A module can run for many server renders, and a store is never global.
  Create state per island instance in its factory, or per browser runtime for a shared Mirror.
- **The factory and `view` are render-pure.** They run on the server, during static generation and
  during hydration. Do not create effects, read `window`, the URL, storage or the document, start timers
  or fetch there. Browser work starts in `mount({ root, lifetime })`.
- **Everything started in `mount` ends with the lifetime.** Pass `{ signal: lifetime }` to
  `addEventListener`, pass the lifetime's signal to requests, and release anything else in `dispose()`.
  Scope DOM queries to `root`, never `document`.
- **The DOM is output, not state.** Render from signals. Do not store state in `dataset`, attributes or
  classes and read it back. An island owns its root descendants; nothing outside it may replace them.
- **`effect` only synchronizes with something outside.** Derived values are `computed`. An effect is
  never `async`. Do not unconditionally read and write the same signal in one effect.
- **Stores write only through actions.** Their async work is a task; a server answer is never a task
  result, because a task has no cache, deduplication or invalidation.
- **Responses are validated.** Check `response.ok`, then run `parse` on the payload. A TypeScript
  assertion is not validation. Separate loading, a valid empty result and an error.
- **Version gate.** Stores and Mirror need ketjs-view 0.8.0 or later. Form sessions need 0.4.0 or later.
  If the consumer runs an older ketjs-view, do **not** build a substitute (a cache, a store-like
  object, a draft manager). Use the documented pattern for that version, such as the cancellable
  reactive request in `view-effects-data.md`, and note in the pull request that the feature waits for
  an upgrade.
- **Existing hand-written state is not a precedent.** When you change an island, move the state you
  touch to its owner in the table. Leave untouched code to an agreed migration plan.

## 12. Modules and composition

- `defineModule` with `depends` for hard requirements and `optional` for soft integrations. Decide at
  run time whether an optional module is present (`ctx.manifest.models[...]`).
- An effect on a module that is neither reachable nor optional is an error for jobs and enqueues, and a
  `contract_warning` for function reads and writes until 1.0. Treat the warning as an error:
  `ket check --strict` fails on it.
- Integration between modules (for example, a sale that raises an invoice) is a named wrapper exported
  by a bridge module and composed in the deployment. A reusable module does not import a private one.

## 13. Tests

- Use `callFn()` for operation logic and real HTTP for request behavior. Give each test or suite its
  own isolated app, and close every harness, even after a failed assertion.
- Cover denial as well as success, at least two companies, and explicit job draining. Do not use sleeps.
- Assert durable state or public output, not internal timing.
- For an invariant that matters (balances, stock, numbering, scope), break the code once and confirm
  the test fails. A test that stays green under the mutation is not testing the invariant.

## 14. Before opening a pull request

- [ ] New functions use `defineFn` and declare `output`, `returns` and complete `effects`.
- [ ] Every write reachable by retry, record command or agent is `idempotent: true` and has a stable key.
- [ ] Refusals use the consumer's single shape, with message-key codes. Refusal after a write throws to roll back.
- [ ] Every caller-sent id is reloaded within the write company.
- [ ] No floating arithmetic on money or quantities. Business dates use a named timezone.
- [ ] Commands are shown with `ctx.allows`, not with `live` alone.
- [ ] No new local `invalid`, `refused`, `now` or company-filter helper was added to a module.
- [ ] `ket check --strict` passes, and date tests pass with `TZ=UTC`.
- [ ] The pull request names the documentation pages read for this change.
- [ ] Every piece of browser state has its owner from section 11; no module-level mutable state.
- [ ] Browser work starts in `mount` and ends with `lifetime`; no `history.pushState` or `location.href =`.
- [ ] Server reads go through Mirror and edits through a form session, or the pull request names the version gate.

A quick scan of the files you changed:

```bash
# Run from: /path/to/consumer
# BASE is the branch the pull request targets.
git diff --name-only "${BASE:-origin/integration}" -- '*.ts' '*.tsx' | grep -vE '__test__|\.test\.' | xargs grep -nE \
  "(const|function) (invalid|fail|refuse|refused|failure|now|ours) |class \w+ extends Error|Number\([^)]*(amount|price|total|qty|quantity)|\.toFixed\(|catch( \(\w+\))? \{ *\}|live\[|^let |^(export )?const \w+ = new (Map|Set|WeakMap)|history\.(push|replace)State|location\.href ?=|document\.(querySelector|getElementById)|dataset\.\w+ ?=|(inner|outer)HTML ?=" || true
```
