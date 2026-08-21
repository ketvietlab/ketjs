# Odoo collaboration cutover runbook

This runbook moves the Odoo 19 collaboration slice described in
`06-odoo19-collaboration-port-plan.md`. It deliberately separates extraction and
blob streaming from the transactional KetSuite import. Odoo credentials and raw
attachment bytes never enter an import run row.

## 1. Safety properties

- A source is identified by the Odoo database UUID, not its host or numeric ids.
- Every source row maps by `(source, Odoo model, Odoo id, Ket target model)`.
  The target id is deterministic and the explicit map is retained for audit.
- A snapshot or delta batch is atomic. Its source checkpoint moves only after the
  target rows, durable jobs, maps, issues and completed run commit together.
- Replaying the same run id and payload returns its stored report. Reusing that
  run id for different content is rejected. A new run over unchanged rows skips
  them without creating duplicates.
- Delta import requires an exact `previousCursor` match. Two importers cannot
  silently advance the same source from different checkpoints.
- Rollback is read-only. The importer never tries to infer reverse mutations after
  KetSuite has accepted writes.

## 2. Normalized export contract

The extractor streams Odoo rows in bounded batches and emits this envelope to
`odoo_collaboration_import.previewBatch`, then to
`odoo_collaboration_import.importBatch` after review:

```json
{
  "batch": {
    "runId": "freeze-0004",
    "sourceId": "odoo-prod",
    "sourceName": "Odoo production",
    "databaseUuid": "the-ir-config-parameter-database-uuid",
    "odooVersion": "19.0",
    "mode": "delta",
    "previousCursor": "2026-08-20T01:00:00Z,41820",
    "cursor": "2026-08-20T01:05:00Z,41904",
    "bindings": [],
    "rows": []
  }
}
```

The cursor is extractor-owned and opaque to KetSuite. Use a stable compound
cursor such as `(write_date, id)`, and query the next batch with a strict tuple
comparison so rows sharing a timestamp are neither lost nor repeated.

Bindings connect records migrated by another vertical to this slice. For example,
`product.product/100 -> mail.Thread/thread:product:100`, `res.partner/7 ->
partner.Partner/p-contact`, and `res.users/5 -> user.User/u-admin`. Bindings are
allowlisted and their Ket targets must already exist. They are never dynamic table
names supplied by an untrusted caller.

Supported normalized row models are:

| Odoo row | Imported data |
| --- | --- |
| `mail.message.subtype`, `mail.message`, `mail.tracking.value` | subtype, safe plain-text history and tracking snapshots |
| `mail.followers`, `mail.notification` | follower/subtype joins and recipient state |
| `mail.activity.type`, `mail.activity`, `mail.activity.plan`, `mail.activity.plan.template` | activity vocabulary, open/kept history and plans |
| `calendar.recurrence`, `calendar.event`, `calendar.attendee`, `calendar.alarm`, event tag rows | timezone-aware Calendar graph |
| `ir.attachment` | attachment metadata and message/activity link |
| `mail.template`, `mail.mail` | reviewed template plus pending/failed delivery snapshots |
| `mail.alias.domain`, `mail.alias` | inbound names and allowlisted bridge configuration |

Odoo HTML in messages, activities and event descriptions becomes plain text.
Unsupported recurrence rules become errors rather than approximations. Templates
containing QWeb/Jinja syntax are imported disabled for manual rewrite. Sent
`mail.mail` rows are not imported or re-enqueued; their history is the linked
Message. Pending rows commit a `mail_transport.Delivery` and one durable delivery
job. Failed rows stay failed for explicit operator retry.

### Attachments

Stream bytes before importing their metadata. Compute SHA-256 while streaming and
write to `blobs/<company>/<first-two-hex>/<sha256>` through the configured Storage
adapter. A stored `ir.attachment` row must carry that exact key, 64-character
checksum and byte count; URLs carry neither key nor checksum. Keep the extractor's
copy/checksum ledger with the run artifacts. Do not embed base64 bytes in the
transactional batch.

## 3. Snapshot and online deltas

1. Back up Odoo PostgreSQL and the attachment filestore. Record the database UUID,
   Odoo version, company mapping and UTC clock skew.
2. Migrate the referenced business records, partners and users first. Produce the
   explicit bindings and create each business record's `mail.Thread` through its
   typed KetSuite bridge.
3. Copy attachments to Ket Storage and verify count, bytes and SHA-256 against the
   copy ledger.
4. Extract a bounded snapshot, call `previewBatch`, and archive the input plus
   returned checksum/report. Do not apply while the report has unexplained errors.
5. Call `importBatch` with a unique run id. Reconcile per-model `received =
   inserted + updated + skipped + unresolved`, issue codes, attachment ledger and
   `timezoneConversions`.
6. While Odoo remains writable, repeat delta batches using the exact previous
   checkpoint returned by the last committed source run. Preview every batch.

Missing partners/users, absent business targets and orphaned old map targets are
errors in the run report. Unsupported template syntax, removed secret-like alias
defaults, deliberately omitted sent mail and unlinked attachment target models are
warnings. Neither category is silently discarded.

## 4. Freeze and drain

1. Announce the write freeze. Put the Odoo collaboration endpoints and UI in
   maintenance/read-only mode; stop inbound mail aliases, calendar sync cron and
   outbound mail workers. Keep reads available.
2. Record the freeze cursor. Drain Odoo transactions already in flight, then
   extract the final strict delta through that cursor.
3. Preview and import the final delta. The `previousCursor` must equal the last
   KetSuite source checkpoint.
4. Confirm that Odoo has no unclassified collaboration writes after the cursor.
   Pending and failed outbound mail must be represented in the final report; sent
   mail must only produce the documented omission warning.
5. Reconcile source/target row counts, all error issues, attachment bytes/checksums,
   normalized UTC instants and a sample around each used timezone's DST boundary.
6. Keep Odoo frozen. Start KetSuite workers and inbound provider callbacks, then
   switch authenticated traffic. Verify Product/Stock Chatter, My Activities,
   Agenda/Week/Month, inbox, Outbox and inbound diagnostics with the browser E2E.

## 5. Read-only rollback

Call `odoo_collaboration_import.rollbackManifest` for the final runs and archive
the returned target list. The call performs no writes.

If rollback is required before any KetSuite business write, stop KetSuite inbound
callbacks/workers, keep its database and Storage read-only for audit, and route
traffic back to the still-frozen Odoo database before lifting the Odoo freeze.

If KetSuite has accepted business writes, do not delete imported targets and do
not run an automatic reverse merge. Freeze both sides, export the KetSuite delta,
decide its mapping with domain owners, and either reconcile forward into Odoo or
resume KetSuite after correction. The import map and run reports are the audit
manifest; they are not a destructive undo log.
