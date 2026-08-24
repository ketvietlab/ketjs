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

## Infrastructure boundaries

- Keep provider credentials in deployment configuration, not module declarations.
- Namespace every tenant before storage access.
- Stream large bodies and apply explicit byte/part/header limits.
- Put outbound work in durable, idempotent jobs.
- Treat notifications as accelerators, never sources of truth.
- Close custom storage or transport resources from the application lifecycle when their contract
  requires it.
