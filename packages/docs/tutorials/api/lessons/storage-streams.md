---
title: "Handle files, outbound services and streams"
description: "Design bounded uploads, tenant-owned storage and resumable delivery without buffering everything into memory."
stage: "Go beyond requests"
duration: 45
lab: "Local server extension"
order: 27
---

Before you start: complete [Run durable background work](/learn/jobs/), or make sure you can pass its checkpoint.

## Begin with an attachment workflow

Extend the task concept with an attachment: a user uploads a file, the server stores it under the resolved tenant namespace, and an authorized user later downloads it. Write the expected size/type limits and access rules before choosing a storage provider.

The framework storage contract accepts async byte iterables. Keep the request bounded and streaming. The JSON parser from the API lesson is suitable for small structured input, not for uploading a large file as a base64 string.

## Use local storage first

Configure a private local storage directory for the disposable lab. Store through the framework's namespaced storage contract. Do not bypass it by writing directly to a bucket root or constructing a filesystem path from a submitted filename.

A storage key is an application identifier. Validate its segments; do not treat `../`, absolute paths or a user's original filename as a trusted key. Keep display filenames separate from internal object keys.

## Protect the download

Resolve identity on the download request and require the relevant attachment permission. A hard-to-guess URL is not sufficient for a private file. Verify that another company or tenant cannot retrieve the object, even when it knows its key.

When moving to S3-compatible storage, configure endpoint, bucket and credentials through runtime settings. Keep application code dependent on the storage contract and test the provider-specific behavior separately.

## Move outbound work behind a job

For a “send task summary” extension, enqueue work from the business transaction. The job calls the configured transport with declared effects and an idempotency key. Do not make a shared render function send a message or create a blob.

## Add streaming only when its semantics are clear

For progress updates, define event IDs, resumption behavior and an expiry policy. Test disconnect/reconnect and a slow consumer. A continuously open connection does not eliminate the need to persist important job state.

This lesson is a provider integration lab. The starter does not ship cloud credentials or claim to test an external provider; use a disposable local store first and follow the integration contracts when adding a provider.

## Checkpoint

Your attachment design includes bounds, namespace ownership, authorized retrieval and cleanup. Demonstrate local put/read/delete before integrating a cloud provider.

## Practice on your own

Write a test matrix for oversized upload, interrupted upload, missing object, wrong company and retrying an outbound operation.

## Reference

For the complete API contract, read [Integrations](/docs/integrations/).
