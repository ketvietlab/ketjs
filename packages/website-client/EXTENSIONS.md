# Website Studio extension contracts

The core (`client/`, `server/`) is MIT. Website Pro (`pro/`) is private and UNLICENSED, and it reaches the
core only through the two registries below and the public package name
`@ketvietlab/website-client`. `test/boundary.test.mjs` fails if the core imports Pro, or Pro imports a
core file by relative path.

## Client registry (`client/extensions.mjs`)

The product entry calls `registerWebsiteExtension(extension)` before it creates the Studio island. The
registry is module state for the whole page: an entry chooses its edition once and never registers per
request. Registration is all-or-nothing. It refuses a duplicate name, a route key or path the core or
another extension owns, an unknown navigation group, a modal returning to an unknown route, a taken
error code and a message key that already exists. A refusal leaves no trace. Keep message keys under
the extension's own prefix (`websitePro.*`); `pro/test/` checks that for Pro.

```js
registerWebsiteExtension({
  name: 'website-pro',
  routes: { analytics: { title, path: 'analytics', nav: { group: 'home', after: 'overview', icon }, capability } },
  messages: { vi: { 'websitePro.…': '…' } },
  create: (ctx) => instance,
})
```

`WebsiteRoute` fields: `title` (message key), `path` (relative to the Studio base), `nav` (`group`, `after`,
`icon`), `scope` (`site` by default, `company` for company-wide screens), `frame` (`shell` by default,
`workspace` for a full-window tool like the builder), `modal: { back }`, `query` (keys kept in the URL
besides `site`), `capability` (hides the nav entry; the server still checks).

Without an extension its routes, navigation entries, cards and sections do not exist. The core never
renders a locked button or a dead link for a feature it does not have. The only place the Studio
mentions another edition is Settings, from the server's `bootstrap.offer`.

### Instance hooks

Each Studio island calls `create(ctx)` once. The instance may define only the hooks in
`INSTANCE_HOOKS`; anything else is a contract violation.

| Hook                  | Called                                     | Returns                                          |
| --------------------- | ------------------------------------------ | ------------------------------------------------ |
| `read(key, route, signal)` | After navigation to one of its routes | Data for `view`; aborted when the route changes |
| `view(key, data)`     | Rendering one of its routes                | A complete DS page pattern, or a `ModalSheet` for a modal route |
| `readFor(key, route, signal)` | With every core read              | Extension data for a core route, or `null` to skip. A failure is logged and gives `undefined`; it never fails the core screen |
| `commands`            | A button or form names the command         | `{ 'analytics.export': (args, form) => … }`; names carry the extension's prefix |
| `overviewCard(overview, extra)` | Site overview                    | One `Surface`; it takes a full-width row below the core lists |
| `siteSettingsSection(settings, extra)` | Site settings             | One `Section`                                    |
| `mutationError(error, name)` | A write failed                      | `{ message }` to claim it, or `undefined`         |
| `reset()`             | The selected site changed                  | Drop site-specific state                         |
| `dispose()`           | The island unmounts                        | Abort reads, release resources                   |

`extra` is the value the same instance's `readFor` returned for that route. Slots render in
registration order. A slot must return DS components: no new layout, no wrapping `div`, no app CSS
that selects a DS element (the layout rules in CONTRACT.md apply to extensions too).

`ctx` gives an extension: `tr`, `call`, `route()`, `site()`, `boot()`, `theme()`, `busy()`,
`can(capability)`, `href(key, params, query)`, `navigate(key, params, query)`, `refresh()` (re-read the
route), `reload()` (re-read the bootstrap, then the route), `notify(message)` and `slot(hook, value)`.
The getters return values, not signals; an extension cannot write core state.

## Server registry (`server/extensions.mjs`)

Import `createWebsiteServerExtensions(extensions)` explicitly; it is a composed value, not a global. The
browser entry never loads it.

```js
{
  name: 'website-pro',
  queries: { 'website_pro.analytics': { capability: 'website.analytics.read', run: (scoped, input) => … } },
  commands: {},
  beforeMutation: (scoped, { name, input, capability }) => { /* throw to refuse */ },
  dispose: () => …,
}
```

- Names are unique across extensions. An extension may not use a core namespace (`website`,
  `website_studio`, `website_form`): hosts dispatch extensions first, so a core name would replace the
  core write and skip its checks.
- `dispatch(context, name, input)` returns `{ handled: false }` for a name no extension owns. A
  core-only host therefore has no private commands or guards.
- A query checks `requireCapability` and runs. A command goes through `mutate`.
- `mutate(context, { name, input, capability }, write)` calls `context.requireCapability` before it opens
  `context.transaction`. Inside the transaction every `beforeMutation` guard runs in registration order,
  then `write`. Guards see core writes too (`website.publishEntry`, …). Any throw rolls the whole
  transaction back.
- `dispose()` runs every extension's cleanup in reverse order, once, and reports all failures together.

The host owns authentication, tenant and site scope, input validation, revision checks, idempotency and
the durable outbox. No external effect (email, webhook, cache purge) runs inside the retryable
transaction. Every write path, including HTTP, staff tools, import, bulk and automation, must reach the
same `mutate` boundary so permission checks and extension guards cannot be skipped.

This contract is proved by the mock (`atlas/store.mjs`) and `test/store.test.mjs`. KetSuite's
`website_backend` does not call it yet; binding it is production work.

## Atlas adapters

`atlas/store.mjs` is an in-memory host: `requireCapability` reads the fixture actor, `transaction`
snapshots and restores the fixture. It exists to exercise the contract and must never serve production.
`pro/atlas/server.mjs` starts the same Atlas host with the Pro server extension, Pro client modules and
Pro capabilities. Core fixtures contain no Pro data; analytics and portfolio are owned by
`createWebsiteProServer`. There are no approval fixtures.

Publication review and approval extension hooks were removed on 2026-09-30. Entry publishing uses the same Core behavior in Pro.
