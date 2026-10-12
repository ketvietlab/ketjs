# KetJS

KetJS is a module-composable, SSR-first full-stack framework for Node.js. It provides models,
migrations, typed functions, jobs, themes, fragment navigation, and persistent islands without a
required application-server dependency.

> KetJS 0.x is preview software. APIs and deployment contracts may change before 1.0.

## Requirements

- Node.js 24 or newer
- npm

## Create an application

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

The generated project uses SQLite by default, contains a real module and integration test, and runs
at `http://127.0.0.1:3000`.

Application names use lowercase letters, digits, and underscores and must start with a letter. Use
`--dir ./my-app` when the filesystem directory should have a different name.

Keep `@latest` when scaffolding inside another project so npm does not reuse an older locally
installed KetJS CLI. Use an exact tag such as `@0.1.3` for reproducible generation.

## Create an authenticated application

The current coordinated release includes the auth starter. Keep the CLI and runtime on the same release:

```bash
# Run from: /path/to/projects
npx @ketvietlab/ketjs@latest new notes --auth=session
cd notes
npm install
npm run user:add
npm run dev
```

`user:add` reads a login and hidden password; automated input goes through stdin, not argv.
The generated app owns the auth models and native `/auth/login`, `/auth/logout` and `/auth/me`
routes. Credentials and provisioning functions are internal, and the protected sample API filters
notes by their actor. No KetSuite dependency is installed. See the generated README and
[Authentication starter](../docs/content/docs/auth-starter.md).

Session authentication and company scope are separate with the explicit opt-in
`serve.sessions.requireCompany: false`. The default is `true`, preserving existing KetSuite and
business deployments. An identity without company scope still cannot read or write company-scoped data.
An explicit permission resolver remains required for role-based authorization; `[]` grants no
protected operations, while `null` disables restriction. Gateway identities use the same policy
when configured with those session options and otherwise retain the company-required default.

`hashPassword()` and `verifyPassword()` are server-only, dependency-free primitives for new
application-owned identity modules. They preserve the input's Unicode representation, enforce
1–1024 UTF-8 bytes and encode the current scrypt profile (N=32768, r=8, p=3), a 16-byte salt and a
32-byte key. Verification reads the encoded parameters and accepts only the bounded profiles
(32768, 8, 3), (65536, 8, 2) and (131072, 8, 1). Keep accepted profiles when changing the hashing
default so existing hashes remain usable. Unsupported or malformed parameters are refused before
expensive work. The starter applies a 15-character minimum. These additions do not replace
KetSuite's existing credential helpers or stored hashes. The profile is one of the
[OWASP scrypt configurations](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
Pass `null` to `verifyPassword` for an unknown account: it performs the current hashing work and
returns false rather than taking a fast missing-account path.

`isSameOriginRequest(url, req)` compares the HTTP(S) origin's host and port to the request host,
including when an edge terminates TLS. Without an Origin header it requires `Sec-Fetch-Site:
same-origin`; `{ allowMissingOrigin: true }` also permits a non-browser request without either
header, as used by the native login/logout routes. Cookie-bound HTTP operations keep the strict
default. A reverse proxy must preserve the external Host header and enforce accepted hosts.

`createClientAddressResolver({ trustedProxies })` returns a request-to-IP resolver. By default it
uses the socket peer and ignores forwarding headers. With explicitly trusted proxy IP addresses,
it walks `X-Forwarded-For` from the nearest hop until the first untrusted address; malformed chains
fall back to the socket. The starter reads the comma-separated `KET_AUTH_TRUSTED_PROXIES` variable
at workspace load. Configure the actual proxy IPs before using its per-client login limiter behind
an ingress; otherwise all clients behind that ingress share a peer rate window. IP ranges, hostnames
and wildcard trust are not accepted. The edge must append or replace forwarding headers and the
application listener must be reachable only through that edge. See the generated deployment guide.

## Install in an existing project

```bash
# Run from: notes
npm install @ketvietlab/ketjs
```

```ts
// File: notes/ket.workspace.ts
import { defineDeployment, defineModule, defineWorkspace } from '@ketvietlab/ketjs'
```

## Generate API contracts

`ket openapi --deployment NAME --out openapi/NAME.json` generates an OpenAPI 3.1 document from the compiled
workspace without starting a server or database. Use `--profile` when the contract profile differs from the
deployment name and `--options FILE` for JSON metadata and security definitions. See the
[HTTP contracts and OpenAPI guide](https://ketjs.dev/ketjs/openapi/#generating-openapi) for protected operations.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)

## Transactional form actions

`defineFormAction(contract, { effects, handler })` declares an ordinary permission- and scope-checked
function. It validates shared nested values, requires an idempotency key, and commits database writes
and the accepted receipt in one transaction. Returned invalid/conflict outcomes unwind earlier writes.
All outcomes retain the declared output boundary. Notifications reach root listeners after commit,
are discarded on rollback, and are not repeated when a receipt is replayed.
The domain handler must check and advance the aggregate revision using the supplied transaction
context; all writers must participate. External effects need staging or an outbox.

`transactional: true` is the underlying opt-in function contract and requires `idempotent: true` and a
real execution with a key. Existing functions keep their execution semantics. Read the
[Transactional form actions](../docs/content/docs/form-actions.md) for native routes and a complete
revision-guarded save example. Shared schemas and keyed rows are covered by
[Form validation](../docs/content/docs/form-validation.md); browser sessions and retry behavior are
covered by [Forms and edit sessions](../docs/content/docs/view-forms.md).
