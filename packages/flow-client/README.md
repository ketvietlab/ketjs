# Flow core for KetSuite

`@ketvietlab/flow-client` is the MIT Flow client and extension boundary. It composes
`@ketvietlab/flow-ui` and uses only public KetJS/KetSuite dependencies. It has 76 core
routes. No private feature package, token, license server or telemetry is required.

Flow is delivered as a KetSuite deployment, not a separate framework or product
repository. The existing `flow`, `flow_backend`, `livedoc`, identity, company, storage
and mail modules provide its server foundations. This package does **not** replace
those modules or claim that the new client API has already been wired to them.

## Package entry

```js
import { createFlowWorkspace } from '@ketvietlab/flow-client'
import { createFnClient } from '@ketvietlab/flow-client/api'
const workspace = createFlowWorkspace({ screen: 'my-work', basePath: '/flow/' }, {
  call: createFnClient(),
})
```

Register this factory with KetJS View's island manager; do not call `mount` manually
in a product. Load `@ketvietlab/design-system/tokens.css` and
`@ketvietlab/flow-ui/styles.css`. Server rendering emits a deterministic loading view.
A deployment provides authenticated, scoped HTTP functions. `API-CONTRACT.md` records
the proposed adapter and which APIs remain mock-only.

Private features register through [EXTENSIONS.md](EXTENSIONS.md). Missing extensions
have no routes or navigation. Core retains task completion, dependency checks, forms,
sprint reports, documents and the shared access model. Production authorization always
runs server-side, regardless of installed client extensions.

## Public checkout development

```sh
npm ci
npm run build
npm --workspace @ketvietlab/flow-client test
npm --workspace @ketvietlab/flow-client run atlas -- --port 4260
```

Open `http://127.0.0.1:4260/flow/my-work`. **Atlas uses in-memory synthetic data** and
starts a new fixture session on a full reload. The development server and fixtures
are not included in the npm artifact. They must never be deployed as the product API.
No companion private checkout is needed to build, test or run this core demo.

`client/` retains the imported JavaScript application as a compatibility boundary:
syntax/lint/runtime checked, not yet fully TypeScript checked. The repository's
existing strict TypeScript checks are unchanged. `npm run build` stages the client
into dist atomically along with other package artifacts. Test files, fixtures and
private dependencies are excluded from the package; release tooling checks its
exports and can install the tarballs into an empty directory.

MIT applies to the source. See NOTICE for trademark attribution. This code does not
include paid features or grant permission to imply endorsement by Két Việt.
