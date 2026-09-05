---
title: Storage, transport, and streams
description: Use tenant-namespaced blob storage, bounded uploads, outbound providers, and resumable streams.
---

KetJS keeps infrastructure behind small contracts. The framework provides local and S3-compatible
storage, a provider-neutral outbound transport, bounded multipart parsing, and resumable streams.

## Storage contract

```ts
// File: src/modules/integration/index.ts
type Storage = {
  name: string
  public?: Storage
  publicUrl?: (key: string) => string
  put(
    key: string,
    body: AsyncIterable<Uint8Array>,
    options: { type: string; size?: number },
  ): Promise<Stored>
  get(key: string): Promise<{ body: AsyncIterable<Uint8Array>; meta: Stored } | null>
  head(key: string): Promise<Stored | null>
  remove(key: string): Promise<void>
  list(prefix: string, options?: { after?: string; limit?: number }):
    Promise<{ keys: string[]; next?: string }>
  signedUrl(key: string, options: { expiresIn: number }): Promise<string | null>
}
```

Object bodies are async iterables so large uploads and downloads do not require one in-memory buffer.
Keys must be relative, normalized segments; empty segments, `..`, backslashes, NULs, and internal
metadata suffixes are rejected.

## Local storage

Local disk is the default:

```bash
# Run from: /path/to/ketjs
KET_STORAGE=local
KET_STORAGE_DIR=.ket/storage
```

Programmatic construction:

```ts
// File: src/modules/integration/index.ts
import { localStorage } from '@ketvietlab/ketjs'

const storage = localStorage({ dir: '.ket/storage' })
```

Local storage is appropriate for development and single-host deployments with durable shared disk. It
is not replicated across stateless pods.

## S3-compatible storage

Configure S3, MinIO, or a compatible endpoint:

```bash
# Run from: /path/to/ketjs
KET_STORAGE=s3
KET_S3_ENDPOINT=https://s3.example.com
KET_S3_REGION=us-east-1
KET_S3_BUCKET=erp-files
KET_S3_KEY=access-key
KET_S3_SECRET=secret-key
KET_S3_PATH_STYLE=0
```

Set `KET_S3_PATH_STYLE=1` for providers such as local MinIO configurations that require path-style
bucket URLs.

The implementation signs requests with SigV4 and supports put, head, streamed get, list, delete, and
presigned get. No cloud SDK is required.

Override `serve.openStorage` to supply another implementation.

## Optional private and public buckets

Single-backend configuration remains supported. To enable a second backend, keep the existing
`KET_S3_*` settings for the **private/default** bucket and add explicit public-bucket settings:

```bash
# Run from: /path/to/ketjs
# Configure both serve and worker roles; values below are placeholders.
KET_STORAGE=s3
KET_S3_ENDPOINT=https://s3.example.com
KET_S3_BUCKET=erp-private
KET_S3_KEY=private-access-key
KET_S3_SECRET=private-secret-key

KET_S3_PUBLIC_BUCKET=erp-public
KET_S3_PUBLIC_KEY=publisher-access-key
KET_S3_PUBLIC_SECRET=publisher-secret-key
KET_STORAGE_PUBLIC_URL=https://media.example.com
```

`KET_S3_PUBLIC_ENDPOINT`, `KET_S3_PUBLIC_REGION`, and `KET_S3_PUBLIC_PATH_STYLE` are optional and inherit
the private backend's corresponding settings. Public credentials never fall back to private
credentials. Partial configuration and an identical endpoint/bucket pair fail at storage initialization.
Store real credentials in environment secrets, not source control. Provision distinct buckets and
bucket-scoped credentials separately: KetJS does not create buckets, change ACLs, or configure a CDN.
Operators must also ensure that endpoint aliases or local filesystem symlinks do not map the two
configured backends to the same physical storage.

`KET_STORAGE_PUBLIC_URL` is optional. It is the HTTP(S) base URL mapped to the public bucket root
(optionally beneath a CDN path), not a presigned URL. It must not contain credentials, a query, or a
fragment. Never point it at the private bucket. Without it, the application can proxy public objects
or issue short-lived signed GETs using the second backend; the bucket need not allow anonymous reads.
For direct public delivery, configure read-only public/CDN access separately and disable anonymous
listing, writes, and deletes. Set appropriate content types and `X-Content-Type-Options: nosniff` on
the delivery origin/CDN; application redirect headers do not apply to the response from that origin.
Use an origin that does not receive application authentication cookies.

For local development, use `KET_STORAGE_DIR=.ket/private` and
`KET_STORAGE_PUBLIC_DIR=.ket/public`. The directories must not overlap. This does not create a static
file server; omit `KET_STORAGE_PUBLIC_URL` unless another server exposes that directory. Local storage
must be shared by web and worker processes; unrelated pod filesystems are not a shared backend.

Custom deployments can compose two backends using `withPublicStorage(privateBackend, publicBackend,
{ baseUrl })` in `serve.openStorage`. Alternatively, supply `RuntimeConfig.publicStorage` with a
`kind: 'local'` or `kind: 's3'` configuration. Root calls (`storage.put/get/remove/signedUrl`) always
target the private/default backend. Only explicit `storage.public` calls use the second backend.
Both inherit tenant namespacing and worker effect checks, including public URL generation.

### KetSuite attachment publication

The `storage` module applies the following lifecycle when the second backend is enabled:

1. Upload writes the original to the private/default backend. `Attachment.storeKey` retains its
   content-addressed key; private is the default visibility. Authorized metadata and the optional
   publication job are committed in the same transaction.
2. A public upload with an allowed inline media type queues `storage.publish` on `maintenance`.
   The worker rechecks visibility and company, streams a copy to the public backend, then records
   `Attachment.publicStoreKey`. Each key includes company, a hash of attachment ID, and content
   checksum. Two attachments sharing an original do not share a public projection.
3. `/files/{id}` resolves attachment permissions/visibility first. A ready public projection uses
   its public URL, if configured, or is read from the public backend. Private attachments never use
   that backend. Pending or failed publications still download through the existing private-source
   path, with the same authorization/public predicate. Failed jobs use the normal queue retry policy.
4. Removing an attachment removes metadata immediately. `storage.sweep` later collects unreferenced
   originals and public projections independently, respecting the grace period (default one hour,
   minimum five minutes). A deletion during copying is rechecked before publication is recorded.

The inline allowlist is AVIF, GIF, JPEG, PNG, WebP, and PDF. HTML, SVG, unknown types, and other active
content are not copied to public storage and keep the application's forced-download path. This is a
media-type policy, not byte-level validation, malware scanning, resizing, or generation of renditions;
public projections currently contain the uploaded bytes unchanged. An attachment declared public is
intended to be accessible without a session. A copied object's URL bypasses application authorization,
so deleting metadata does not instantly revoke an already known public/CDN URL. Emergency removal
requires object deletion and any necessary CDN invalidation; private/revocable assets must stay private.

Run a worker consuming `maintenance` with the same tenant resolution and bucket routing as the web
role. Worker public-bucket credentials need write/read/list/delete access; web credentials can be
read-only for that bucket. Existing single-bucket uploads do not enqueue publication work. Application
code calling `storage.createAttachment` directly can request `publishCopy: true` for a public stored
attachment; clients cannot assign `publicStoreKey` themselves.

Enabling the second backend does not bulk-migrate at boot. Apply the additive attachment schema
migration to every tenant database before running the updated web/worker code, then request
`storage.requestSweep` (or `POST /files/sweep`) for each company to queue publication of existing
eligible public attachments. The original keys stay unchanged. Removing the public configuration
returns downloads to their original source; it does not delete public objects or invalidate their URLs.
Manage those objects/CDN caches explicitly when retiring the public backend. This feature does not add
multi-file uploads or presigned PUTs.

## Tenant namespaces

`bootDeployment()` wraps the base storage with `namespacedStorage()`. A route obtains the storage for its
resolved tenant:

```ts
// File: src/modules/integration/index.ts
const storage = await ctx.storageOf(url, request)
await storage.put(`attachments/${attachmentId}`, body, {
  type: contentType,
  size,
})
```

Callers see logical keys; the base backend receives a tenant prefix. Keep attachment metadata in the
tenant database and blob bytes in the storage backend.

Job storage is additionally wrapped by `storage:read`, `storage:write`, and `storage:remove` effects.

## Bounded multipart uploads

`multipart()` parses parts sequentially and streams each part body:

```ts
// File: src/modules/integration/index.ts
import { multipart } from '@ketvietlab/ketjs'

const contentType = String(request.headers['content-type'] ?? '')

for await (const part of multipart(request, contentType, {
  maxBytes: 25 * 1024 * 1024,
  maxParts: 20,
  maxHeaderBytes: 16 * 1024,
})) {
  if (part.name === 'file' && part.filename) {
    await storage.put(`uploads/${id}`, part.body, {
      type: part.type ?? 'application/octet-stream',
    })
  }
}
```

Consume a part body before requesting the next part. The parser rejects invalid boundaries, oversized
bodies or headers, too many parts, and malformed dispositions. Configure the default application
limit with `KET_UPLOAD_MAX`.

Sanitize and store the original filename as metadata; do not use it directly as a storage key.

## Outbound transport

KetJS defines a provider-neutral delivery contract for email-like messages:

```ts
// File: src/modules/integration/index.ts
type OutboundTransport = {
  name: string
  send(
    message: OutboundMessage,
    options?: { signal?: AbortSignal },
  ): Promise<TransportReceipt>
  close?(): Promise<void>
}
```

The application injects a provider at deployment time:

```ts
// File: src/app.ts
const app = defineDeployment({
  name: 'erp',
  modules: [mail],
  headless: true,
  serve: {
    openTransport: (config) => createCompanyMailTransport(config),
  },
})
```

Without a provider, the runtime uses `unavailableTransport()`: applications still boot, but a job that
attempts to send receives `E_TRANSPORT_UNAVAILABLE`.

Every message needs:

- a stable `idempotencyKey`;
- one `from` address and at least one recipient;
- `subject` and plain `text` body;
- optional HTML, reply-to, CC/BCC, and headers.

`validateOutboundMessage()` rejects header injection, empty recipients, and invalid envelope fields.
Jobs require `transport:send` before the provider call can begin.

The transport contract does not provide an SMTP or Google Workspace implementation by itself. The
deployment owns credentials, provider SDKs, retry semantics, and deliverability configuration behind
`openTransport`.

## Resumable streams

Streams persist ordered batches for clients that disconnect and resume:

```ts
// File: src/modules/integration/index.ts
import { createStreams, dbStreamStore } from '@ketvietlab/ketjs'

const streams = await createStreams(dbStreamStore(adapter))
const writer = await streams.open('generation:42')

writer.write({ token: 'Hello' })
writer.write({ token: ' world' })
await writer.flush()
await writer.end({ tokens: 2 })
```

Read what arrived since a cursor:

```ts
// File: src/modules/integration/index.ts
const result = await streams.since('generation:42', cursor)

for (const chunk of result.chunks) consume(chunk.data)
cursor = result.nextSeq
```

Or follow a live stream:

```ts
// File: src/modules/integration/index.ts
for await (const chunk of streams.tail('generation:42', cursor, {
  pollMs: 250,
  timeoutMs: 30_000,
})) {
  consume(chunk.data)
}
```

Writes are buffered by time and count, so one token is not one database transaction. A writer
recovers its sequence once when opened; a resumed reader receives no gap and no duplicate. Call
`sweep()` to remove completed streams after their grace period.

Use `memoryStreamStore()` for one-process ephemeral work and `dbStreamStore(adapter)` when streams must
survive reloads or be visible across processes.

The framework SSE endpoint, `/_ket/stream/:id`, is closed unless the deployment supplies
`resolveStream`. The resolver is both the authorization boundary and the mapping from a public id to the
exact tenant-namespaced topic used by the writer:

```ts
// File: src/server.ts
const server = await createKetServer({
  manifest,
  adapter,
  resolveStream: async (id, url, request) => {
    const identity = await authenticateStream(url, request)
    return identity ? `${identity.tenant}:generation:${id}` : null
  },
})

const writer = await server.streams.open(`${tenant}:generation:${generationId}`)
```

Returning `null`, or omitting the resolver, returns `404` without reading the stream store. The
high-level deployment API exposes the same seam as `serve.resolveStream` and returns the matching
writers as `BootedDeployment.streams`. The writer and resolver must deliberately share one namespace;
KetJS does not infer it from an actor or from an untrusted header.

This closes HTTP exposure but does not make one deployment-wide stream store durable per tenant. A
database-per-tenant deployment still needs to choose the backing-store ownership model explicitly.

## Infrastructure boundaries

- Keep provider credentials in deployment configuration, not module declarations.
- Namespace every tenant before storage access.
- Stream large bodies and apply explicit byte/part/header limits.
- Put outbound work in durable, idempotent jobs.
- Treat notifications as accelerators, never sources of truth.
- Close custom storage or transport resources from the application lifecycle when their contract
  requires it.
