---
title: Authentication starter
description: Scaffold account models, signed sessions and operation grants without depending on KetSuite.
group: Identity and access
order: 0
---

The session starter creates an application that can provision an account, authenticate it and call
protected operations immediately. KetJS owns session mechanics, actor/scope resolution and permission
enforcement. Your generated module owns account records and policy. KetSuite continues to use its own
User, company, role and permission models with the existing company-required defaults.

:::note[Coordinated release]
The session starter ships with KetJS {{VERSION}}. Use the CLI and framework runtime from the same
coordinated release; the command below selects the current version explicitly.
:::

## Create and run

```bash
# Run from: /path/to/projects
npx @ketvietlab/ketjs@{{VERSION}} new notes --auth=session
cd notes
npm install
npm run user:add
npm run dev
```

`user:add` asks for a login and a hidden password of at least 15 characters. In automation, it accepts
a JSON object with `login` and `password` on stdin. The script invokes the framework's internal
provision command; credentials never enter its argv or environment. There is no default password or
HTTP signup/provision endpoint. The API runs on `http://127.0.0.1:3000` with SQLite.

The module name `auth` is reserved in this preset; choose a different application identifier.
Omitting `--auth` or selecting `--auth=none` preserves the existing public starter.
Bare `--auth` selects session auth without consuming the project name or the next option.

## What is generated

| File | Responsibility |
| --- | --- |
| `modules/auth.ts` | User, Role, Grant and Assignment models; credential checks; native auth routes; live account resolver. |
| `modules/notes.ts` | Protected list/create operations; ownership is derived from the actor. |
| `ket.workspace.ts` | Session configuration, live function-grant resolver and login rate policy. |
| `tools/provision.mjs` | Interactive or stdin provisioning. |
| `test/deployment.test.ts` | A real HTTP provision/login/write/read/logout flow. |
| `README.md` | Project-specific onboarding and extension instructions. |

The first account creates a Member role with explicit grants for `auth.me`, `notes.list` and
`notes.create`. Later accounts share the role. Creating another account does not restore revoked
grants, and adding a new operation does not implicitly authorize it. Extend role/grant management
in your application's module as its policy grows.

## Sign in and use the API

Enter a JSON object containing your provisioned login and password into curl's stdin, then press Ctrl-D:

```bash
# Run from: notes
mkdir -p .ket
curl --cookie-jar .ket/cookies --json @- http://127.0.0.1:3000/auth/login
```

```bash
# Run from: notes
curl --cookie .ket/cookies http://127.0.0.1:3000/auth/me
curl --cookie .ket/cookies --header 'Origin: http://127.0.0.1:3000' --json '{"title":"Private note"}' http://127.0.0.1:3000/api/v1/notes/create
curl --cookie .ket/cookies http://127.0.0.1:3000/api/v1/notes
curl --cookie .ket/cookies --request POST http://127.0.0.1:3000/auth/logout
```

Signed-in users see their own notes. Anonymous requests and forged development identity headers
cannot reach these operations. Credential checking and provision functions use `exposure: 'internal'`
and do not appear on generic HTTP or agent surfaces. Native auth routes own JSON parsing, same-origin
checks and response shaping. Login accepts at most 4096 body bytes and uses a durable
five-attempt-per-minute rate policy before credential hashing. With no trusted proxies configured,
the key is the socket peer; see the proxy configuration below before deploying behind an ingress.

Cookie-authenticated writes through HTTP bindings require a same-origin request. Browsers supply the
origin; command-line clients must send it explicitly, as in the create example above. The starter
does not disable the framework's CSRF boundary.

## Connect identity, grants and scope

```ts
// File: notes/ket.workspace.ts
serve: {
  sessions: { requireCompany: false, anonymous: null },
  resolveSession: resolveAuthSession,
  permissions: async (ctx, userId, url, req) => {
    const result = await ctx.callUnchecked('auth.permitted', { userId }, url, req) as {
      functions: string[]
    }
    return result.functions
  },
}
```

`resolveAuthSession` checks live account state and credential revision. Disabling an account or
changing its `securityVersion` rejects existing sessions on the next request. The permission resolver
reads grants live from the request's datastore; it returns a finite list, including an empty list when
the user has no grant. Multiple roles use one combined grants query. Returning `null` instead would
disable restriction. Issuance and live resolution both use `branches: []`, avoiding an unnecessary
context update on the first authenticated requests.

The starter authenticates an identity with no company. `requireCompany` remains `true` by default
for existing business and KetSuite deployments. The opt-in grants no company access: a company-scoped
operation still needs valid membership/scope, and ownership checks remain application behavior.
If you add company-scoped modules, implement real membership resolution instead of inventing a default
company. Read [Sessions and tenants](/docs/sessions-tenants/) and [Authorization](/docs/authorization/).

## Credentials and deployment

The starter stores a `sensitive` password hash, never a plaintext password, and declares outputs that
exclude it. `hashPassword` uses a random 16-byte salt and bounded scrypt (N=32768, r=8, p=3, 32-byte key),
one of the [OWASP scrypt profiles](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
`verifyPassword` parses encoded parameters and accepts only (N, r, p) profiles (32768, 8, 3),
(65536, 8, 2) and (131072, 8, 1), rejecting all other parameters before expensive work. Verification
does not depend on which profile is currently used for new hashes. Passwords are limited to 1024 UTF-8 bytes without truncation or
Unicode normalization. KetSuite's existing hashes and credential implementation are not replaced.
Passing `null` as the encoded hash performs the current hashing work and returns false, so an unknown
account does not take a fast verification path.

Configure a stable `KET_SECRET` shared by replicas before deployment. The development ephemeral key
is reported by the framework and may require signing in again after a restart. Keep cookies and
credential input out of Git; `.ket/` is ignored in generated projects. Piped provisioning preserves
multibyte characters across input chunks and limits the original byte stream to 4096 bytes.
This starter does not provide MFA, password recovery or external identity providers.

### TLS and reverse proxies

Native auth routes and cookie-bound operations use the framework's `isSameOriginRequest` helper.
It compares HTTP(S) origin host/port rather than assuming the listener itself uses HTTPS. Preserve
the public Host header at your TLS edge and enforce accepted hosts there. An opaque `Origin: null`,
different host or different port is refused. Login/logout also allow non-browser clients without
Origin or fetch metadata; cookie-authenticated API writes retain the stricter origin requirement.
Set `serve.sessions.secure: true` for HTTPS deployments, including when the listener binds to
localhost behind the TLS edge; local HTTP development needs non-secure cookies.

When an ingress or load balancer fronts the listener, all requests have that proxy's socket IP.
Configure the actual trusted proxy IPs so one client's five attempts do not consume everyone's
login allowance:

```bash
# Run from: notes
KET_AUTH_TRUSTED_PROXIES=192.0.2.10,192.0.2.11 npm start
```

Replace the example addresses with your edge's real source IPs. The workspace creates
`createClientAddressResolver({ trustedProxies })` once when loaded. It accepts IP addresses only,
not CIDR ranges, hostnames or wildcard trust. It ignores `X-Forwarded-For` unless the socket peer
is trusted and then walks from the nearest hop to the first untrusted address. Injecting a fake
leftmost address cannot replace that untrusted hop. Malformed or oversized chains fall back to
the socket address. Without this configuration, the limit remains per proxy peer.

The trusted edge must replace or append forwarding headers and the listener must be restricted
to that edge. Never trust every address or client-supplied headers directly. If your edge's source
IPs change, update this list before routing traffic through it. The policy is application-owned
in `ket.workspace.ts`; existing KetSuite deployments keep their current policies.

## Verify

```bash
# Run from: notes
npm test
npm run openapi
npm run api:docs
```

The generated deployment test exercises the HTTP boundary with the app's real models and session
configuration. The note bindings also generate a protected OpenAPI contract. See
[HTTP contracts](/docs/openapi/) and [Testing](/docs/testing/) for extending that verification.
