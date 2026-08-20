# Odoo collaboration port — implemented design

This is the implementation map for the Odoo 19 Calendar, Chatter, Activity and
Email port. The domain plan is in `06-odoo19-collaboration-port-plan.md`; the
production migration procedure is in `07-odoo-collaboration-cutover.md`.

## 1. Module and authority boundaries

```mermaid
flowchart LR
  subgraph Owners[Business record owners]
    Product[product.Product]
    Stock[stock.Picking]
  end

  subgraph Bridges[Typed bridge modules]
    ProductMail[product_mail_backend]
    StockMail[stock_mail_backend]
    ProductActivity[product_activity_backend]
    StockActivity[stock_activity_backend]
    StockAlias[stock_mail_inbound]
  end

  subgraph Collaboration[Native collaboration domains]
    Thread[mail.Thread<br/>only polymorphic boundary]
    Message[mail.Message]
    Followers[mail.Follower + Subtype]
    Notification[mail.Notification]
    Activity[activity.Activity + Plan]
    Calendar[calendar.Event + Recurrence]
  end

  subgraph Email[Transactional email]
    Template[mail_transport.Template]
    Delivery[mail_transport.Delivery]
    Queue[(ket_job)]
    Transport[OutboundTransport]
    Provider[Email provider]
  end

  subgraph Inbound[Inbound email]
    Webhook[HMAC route]
    Event[mail_inbound.InboundEvent]
    Token[ReplyToken / References]
    Alias[Alias + AliasDomain]
  end

  Storage[(Storage adapter<br/>content-addressed blobs)]

  Product --> ProductMail --> Thread
  Stock --> StockMail --> Thread
  Product --> ProductActivity --> Activity
  Stock --> StockActivity --> Activity
  Activity --> Thread
  Activity <-->|Meeting bridge| Calendar
  Thread --> Message
  Followers --> Message
  Message --> Notification
  Message --> Delivery
  Template --> Delivery --> Queue --> Transport --> Provider
  Webhook --> Event
  Event --> Token --> Thread
  Event --> Alias --> StockAlias --> Stock
  Message -. attachment metadata .-> Storage
  Activity -. attachment metadata .-> Storage
  Calendar -. attachment metadata .-> Storage
```

Mail never accepts an arbitrary `model/res_id` read from the public function
surface. Product, Stock and Calendar verify their own records under normal company
scope, then an explicit bridge uses `mail.Thread`. This preserves reusable Chatter
without creating a cross-domain record-rule bypass.

## 2. Durable outbound delivery

```mermaid
sequenceDiagram
  autonumber
  participant B as Business function
  participant DB as Tenant database
  participant Q as ket_job
  participant W as Worker
  participant T as OutboundTransport
  participant P as Provider

  B->>DB: BEGIN
  B->>DB: Insert Message + Notification
  B->>DB: Insert immutable Delivery snapshot
  B->>Q: Enqueue deliver(id, version)
  B->>DB: COMMIT rows + job atomically

  W->>Q: Claim with lease and attempt
  W->>DB: CAS queued/retryable -> sending
  W->>T: send(snapshot, stable idempotency key)
  T->>P: Provider request with same key
  P-->>T: providerMessageId / acceptedAt
  T-->>W: receipt (may be deduplicated)
  W->>DB: CAS sending -> sent
  W->>DB: Mark bound Notifications sent
  W->>Q: Complete job

  Note over W,P: A crash after provider acceptance is lease-rescued
  Note over W,P: and retried with the identical key.
  Note over T,P: Exactly-once acceptance requires provider-side idempotency.
```

`ket_job` owns execution state, leases and retry scheduling; it is not the mail
audit log. Delivery owns the immutable envelope/body snapshot, provider id,
attempt summary and terminal business state. Queue pruning cannot erase the
history shown in Outbox or Chatter.

## 3. Inbound route and alias resolution

```mermaid
flowchart TD
  Request[Provider webhook<br/>timestamp + path + exact body] --> Signature{HMAC valid<br/>inside 5 minutes?}
  Signature -- no --> Reject[401 E_INBOUND_SIGNATURE]
  Signature -- yes --> Dedupe{provider + event id<br/>already exists?}
  Dedupe -- yes --> Existing[Return existing outcome]
  Dedupe -- no --> Kind{event kind}

  Kind -- bounce/complaint --> ProviderRef[Resolve providerMessageId]
  ProviderRef --> Delivery[Mark Delivery and Notification failed]

  Kind -- message --> HasToken{reply token supplied?}
  HasToken -- yes --> TokenValid{digest active<br/>and unexpired?}
  TokenValid -- no --> Failed[Terminal failed event<br/>never fall back]
  TokenValid -- yes --> ReplyThread[Existing mail.Thread]
  HasToken -- no --> References{known outbound<br/>References?}
  References -- yes --> ReplyThread
  References -- no --> Alias{explicit alias route?}
  Alias -- no --> Ignored[Bounded ignored diagnostic]
  Alias -- yes --> Bridge{allowlisted bridge installed?}
  Bridge -- no --> Failed
  Bridge -- stock.receipt --> Picking[One draft stock.Picking]
  Picking --> ReplyThread

  ReplyThread --> Plain[Discard active HTML<br/>store plain text]
  Plain --> Attach[Stream attachments to Storage]
  Attach --> Commit[Commit Message + metadata + event atomically]
```

The reply-token branch has priority over References: an invalid supplied token is
terminal, so an attacker cannot combine a guessed token with a valid-looking
provider reference. Alias names never become dynamic model names; each supported
bridge is a declared module depending on both domains.

## 4. Activity and Calendar lifecycle

```mermaid
stateDiagram-v2
  [*] --> Planned: schedule / apply plan
  Planned --> Planned: reschedule
  Planned --> Done: complete(feedback)
  Planned --> Cancelled: cancel
  Done --> Planned: automatic chained activity
  Done --> Chatter: post completion atomically
  Cancelled --> [*]

  state MeetingBridge {
    [*] --> EventCreated: Meeting activity
    EventCreated --> EventUpdated: activity rescheduled
    EventCreated --> EventCancelled: activity cancelled
    EventUpdated --> EventCancelled
  }
```

Activity deadlines and all-day Calendar boundaries use the strict `date` scalar.
Timed events store UTC instants plus an IANA timezone. Recurrence expansion is
bounded and exceptions are explicit rows. Reminder jobs carry the Event version,
so jobs left behind by a reschedule or cancellation become safe no-ops.

## 5. Odoo snapshot/delta import and cutover

```mermaid
flowchart LR
  Extract[Bounded normalized Odoo export] --> Preview[previewBatch<br/>read-only validation]
  Blobs[Stream and SHA-256 attachments] --> Preview
  Bindings[Typed partner/user/thread bindings] --> Preview
  Preview --> Gate{errors explained?}
  Gate -- no --> Fix[Repair mapping/export<br/>preview again] --> Preview
  Gate -- yes --> Tx[Atomic importBatch]

  subgraph Transaction[One tenant transaction]
    Tx --> Rows[Upsert deterministic targets]
    Rows --> Maps[Write stable identity maps]
    Maps --> Issues[Persist warnings/errors]
    Issues --> Jobs[Enqueue pending deliveries]
    Jobs --> Cursor[Advance source checkpoint]
  end

  Cursor --> More{Odoo still writable?}
  More -- yes --> Delta[Next strict delta<br/>previousCursor must match] --> Preview
  More -- no --> Reconcile[Count, orphan, timezone<br/>and attachment reconciliation]
  Reconcile --> Cutover[Start Ket workers/webhooks<br/>switch traffic]
  Cutover -. incident before Ket writes .-> Rollback[Read-only rollback manifest<br/>route back to frozen Odoo]
  Cutover -. Ket accepted writes .-> FreezeBoth[Freeze both sides<br/>explicit forward reconciliation]
```

One Odoo source row may map to several explicit Ket targets because the map key
includes `targetModel`; a `calendar.event`, for example, maps both to its typed
Event and its authorized Thread. The importer never treats an Odoo integer as
globally unique, never persists source credentials, strips secret-like alias
defaults and does not re-enqueue sent Odoo mail.

## 6. Verification and evidence

- Domain, failure and HTTP coverage runs under `npm run verify`.
- Warm authenticated render timings run under `npm run bench:collaboration`.
- Chrome headless interaction, readiness timings and screenshots run under
  `npm run e2e:collaboration`.
- PNG evidence and machine-readable browser timings are under
  `docs/assets/odoo-collaboration/`.
- Live MinIO, PostgreSQL and provider sandboxes remain opt-in; an unavailable live
  service is reported as a skip, never replaced by production credentials.
