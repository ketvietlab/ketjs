# Odoo 19 collaboration port plan

Status: implemented and verified — required PR 0 through PR 7 acceptance is
complete; the PR 8 optional-integration disposition is recorded

Baseline:

- source: Odoo 19 Community semantics and data model
- original target baseline: KetSuite at `origin/develop` commit
  `10eb9dda7f679e4b19cdacd5cca0e1574f926d77`
- final integration baseline: KetSuite at `origin/develop` commit
  `c82758c3f2a1400491899e016cc09c363e2a3350`
- worktree: `/Users/kieuduy/dev/ketjs-odoo-collaboration-plan`
- branch: `codex/odoo-collaboration-port-plan`

This is a semantic port, not a line-by-line translation. Odoo's four visible
features are one collaboration stack: Chatter owns the record timeline, Activity
owns accountable follow-up, Calendar owns timed events and attendees, and Email is
a transport for messages and notifications. KetSuite should preserve those
boundaries while keeping its own explicit module, effect, permission and durable
job contracts.

The implemented component and sequence diagrams are in
[the collaboration design document](08-odoo-collaboration-design.md). Production
snapshot/delta/freeze operations are in
[the cutover runbook](07-odoo-collaboration-cutover.md).

## 1. Scope

The first production slice includes:

- record threads with messages, internal notes, followers, mentions and attachments;
- user inbox notifications and unread counters;
- activities with type, assignee, due date, completion feedback and chained next activity;
- native calendar events with attendees, RSVP, reminders and a bounded recurrence vocabulary;
- the Activity/Calendar meeting bridge;
- durable outbound transactional email;
- inbound reply routing and model-specific aliases through signed provider webhooks;
- an Odoo importer and cutover checks for the corresponding records.

Explicitly deferred from the first slice:

- Discuss chat/channels, live chat, SMS, WhatsApp and mass mailing;
- a Gmail/Outlook-style general mailbox, spam folder or quarantine;
- Appointments and resource booking;
- Google and Outlook calendar synchronization;
- arbitrary SMTP receive and a complete MIME server in the Ket process;
- full RFC 5545 recurrence and every Odoo recurrence exception edge case;
- transparent field tracking on every mutation before Ket has a declared event seam.

The deferred items are later phases, not hidden assumptions in the initial estimate.

## 2. Architecture learned from Storage/S3 and the durable queue

Storage is the reference implementation for asynchronous external I/O:

1. tenant metadata is durable in the tenant database;
2. large bytes stay behind the `Storage` contract and are addressed by key;
3. a producer declares the exact `enqueue:module.job` effect;
4. enqueue inside `ctx.tx()` commits or rolls back with business data;
5. the worker executes at least once with captured actor and company scope;
6. leases, heartbeats, bounded retries, full-jitter backoff and rescue handle crashed workers;
7. a maintenance job reconciles external objects that cannot share the SQL transaction.

Email and reminders should use the same shape:

```text
HTTP/domain function
  └─ ctx.tx()
      ├─ write Message / Notification / Delivery
      └─ enqueue mail_transport.deliver(deliveryId)
             ↓ commit
worker on queue "mail"
  ├─ claim with lease
  ├─ CAS Delivery queued/retryable → sending
  ├─ send through provider using stable idempotency key
  ├─ write provider id + sent/failure state
  └─ complete/retry/discard ket_job
```

Rules inherited from the current queue design:

- `ket_job` is operational delivery state and may be pruned; `Delivery` and
  `Notification` are the durable business/audit state.
- Queue `uniqueKey` only coalesces active work. Handler idempotency remains a
  business responsibility.
- Job arguments contain IDs and versions, never HTML bodies or attachment bytes.
- Attachments remain `storage.Attachment` rows plus object keys.
- A reminder update does not need to cancel an old scheduled job. The job carries
  `reminderId` and `version`; a stale version reads the current row and exits.
- A discarded queue job must leave a visible failed `Delivery` that an operator can
  retry by enqueuing a new job.

There is an unavoidable external-side-effect window: an SMTP server can accept a
message and the worker can die before marking the delivery sent. Provider APIs with
idempotency keys can close that window. Raw SMTP can only reduce duplicates with a
stable RFC Message-ID; it cannot prove exactly-once delivery. The UI and runbook
must not claim stronger semantics.

Storage also exposes the inverse consistency problem. It writes object bytes before
the attachment row, then a grace-period sweep removes old orphans. Inbound email
attachments and optional raw `.eml` archives should reuse that mechanism instead of
building another blob lifecycle.

## 3. Proposed module graph

```text
partner ─┬─ company ─ user
         └──────────────┐
storage ────────────────┤
                        v
                       mail
                 ┌─────┼──────────┐
                 v     v          v
          activity  calendar  mail_transport

activity + calendar       → calendar_activity
calendar + mail_transport → calendar_mail_transport

backend + mail       → mail_backend
backend + activity   → activity_backend
backend + calendar   → calendar_backend

product_backend + mail_backend → product_mail_backend (auto)
stock_backend + mail_backend   → stock_mail_backend (auto)
```

Responsibilities:

- `mail`: headless thread, message, follower, mention, tracking-value and inbox-notification domain.
- `activity`: headless follow-up domain; depends on `mail` because completion posts to the thread.
- `calendar`: native event, attendee, RSVP, reminder and recurrence domain; an event has its own thread.
- `calendar_activity`: explicit bridge adding the optional event relation to an activity and synchronizing meeting operations.
- `mail_transport`: templates, outbound deliveries, provider adapters, aliases, inbound envelopes, bounce state and mail jobs.
- `calendar_mail_transport`: invitation/cancellation rendering and enqueue policy without coupling Calendar to a provider.
- `*_backend`: screens, routes, menus and interactive islands only.
- `product_mail_backend` and `stock_mail_backend`: prove record integration without making Product or Stock depend on Mail.

This follows the existing `product_backend` and `sale_stock`-style bridge decision:
headless business modules do not gain a backend or collaboration dependency merely
because a deployment happens to install one.

## 4. Target data model

All operational records below are company-scoped unless marked otherwise.

### 4.1 Mail and Chatter

| KetSuite model | Odoo source | Purpose |
| --- | --- | --- |
| `mail.Thread` | new explicit anchor | Unique `(companyId, resModel, resId)` target and cached display name |
| `mail.Message` | `mail.message` | Canonical timeline entry, parent, author, kind, subject, safe body, timestamps |
| `mail.Subtype` | `mail.message.subtype` | Subscription/event category; shared or company configuration |
| `mail.Follower` | `mail.followers` | Partner following a thread |
| `mail.FollowerSubtype` | follower/subtype relation | Explicit subscription join |
| `mail.Mention` | message partner relation | Explicit recipients named by a message |
| `mail.Notification` | `mail.notification` | Per-recipient channel, read state and terminal delivery status |
| `mail.TrackingValue` | `mail.tracking.value` | Field name plus old/new JSON snapshots |
| `mail.MessageAttachment` | message attachment relation | Explicit join to `storage.Attachment` |

`mail.Thread` is a deliberate Ket addition. Odoo repeats `model/res_id` on several
tables because its ORM accepts polymorphic references. Ket relations are statically
checked, so one polymorphic boundary on Thread and ordinary foreign keys below it
give better indexing, cleanup and migration behavior.

Message bodies start as escaped plain text plus attachments. Rich text is not
accepted until a sanitizer or a restricted document format is chosen. Storing
arbitrary incoming HTML and rendering it in the backend would turn email into a
stored-XSS endpoint.

### 4.2 Activity

| KetSuite model | Odoo source | Important fields |
| --- | --- | --- |
| `activity.Type` | `mail.activity.type` | category, icon, default delay, chaining policy, next type |
| `activity.Activity` | `mail.activity` | thread, type, assignee, due date, note, active, done date, feedback |
| `activity.Attachment` | activity attachment relation | explicit join to Storage |
| `activity.Plan` | `mail.activity.plan` | named reusable sequence |
| `activity.PlanStep` | `mail.activity.plan.template` | type, offset, assignee strategy, sequence |

State is derived from `active`, due date and the request's date: `overdue`, `today`,
`planned` or `done`. Completion is one transaction that posts a system message,
archives the activity, preserves attachments and optionally creates the next
activity. This follows Odoo 19; the importer handles Odoo 18's delete-unless-kept
behavior separately.

An Email activity is still a task to send an email, not a sent email. A Meeting
activity gains calendar behavior only when `calendar_activity` is installed.

### 4.3 Calendar

| KetSuite model | Odoo source | Important fields |
| --- | --- | --- |
| `calendar.Event` | `calendar.event` | organizer, start/stop UTC, all-day dates, timezone, privacy, thread |
| `calendar.Attendee` | `calendar.attendee` | partner/email, RSVP state, response time, invitation token |
| `calendar.Reminder` | `calendar.alarm` + event relation | channel, offset, version, active |
| `calendar.Recurrence` | `calendar.recurrence` | frequency, interval, weekdays, count/until, timezone |
| `calendar.Tag` | `calendar.event.type` | event classification |
| `calendar.EventTag` | event/tag relation | explicit join |

Timed events store UTC instants plus an IANA timezone. All-day events store dates,
not fake midnight instants. The initial recurrence vocabulary is daily, weekly,
monthly and yearly with count/until and explicit exception events.

`calendar_activity` adds an optional `calendarEventId` field to
`activity.Activity`, plus the relation and synchronization functions. It does not
use hidden hooks. Meeting creation, reschedule and cancellation go through the
bridge functions so the write set and loop-prevention rules are explicit.

### 4.4 Email transport

| KetSuite model | Odoo source | Purpose |
| --- | --- | --- |
| `mail_transport.Template` | `mail.template` | Safe subject/body template over an explicit render context |
| `mail_transport.Delivery` | `mail.mail` | Durable rendered envelope and sending state |
| `mail_transport.DeliveryNotification` | mail/notification relation | Which recipient notification belongs to a delivery |
| `mail_transport.AliasDomain` | `mail.alias.domain` | Company domain, catchall and bounce local parts |
| `mail_transport.Alias` | `mail.alias` | Local part, policy and bridge-owned target kind |
| `mail_transport.InboundEnvelope` | gateway input | RFC/provider id, normalized headers, route state and failure |
| `mail_transport.ProviderEvent` | bounce/provider webhook | Dedupe and audit of delivery/bounce callbacks |

Rendered deliveries are snapshots. A retry must not silently render a changed
customer email, template or language. Templates receive an allow-listed JSON view
model; they never query an arbitrary `resModel` dynamically.

Provider credentials stay in deployment secrets for the first slice. Persisting
per-company SMTP/OAuth credentials is blocked until Ket has an encrypted secret
contract; plaintext database credentials are not an acceptable shortcut.

## 5. Record target authorization and extension contract

The largest architectural mismatch with Odoo is not SQL; it is authorization.
Odoo can ask the referenced model's record rules about any `model/res_id`. Ket
functions declare exact model effects and permissions are function-based, so a
generic `mail.listMessages(resModel, resId)` would become a cross-domain read hole.

The first implementation therefore uses target bridges:

1. the record backend publishes a named joint with only its typed record ID;
2. an auto-installed bridge depends on both the record backend and `mail_backend`;
3. the bridge owns `list/post/follow/schedule` functions;
4. those functions declare effects on both the target model and collaboration models;
5. the target row is checked in the current company scope before thread data is read;
6. the bridge fills the joint with a first-party Chatter island.

Initial proofs:

- `product_mail_backend`: Chatter on `product.Template`;
- `stock_mail_backend`: Chatter and activities on `stock.Picking`.

Shared operations live as typed helpers in `mail/operations.ts` and
`activity/operations.ts`; bridge functions call them with the same `Ctx`. Generic
thread read/write functions are not granted as public role capabilities.

This costs small bridge modules but retains Ket's exact effect boundary. A generic
resource-provider manifest contract may replace the repetition later, after two real
bridges show the common shape. It should not be invented from one hypothetical use.

## 6. Framework gaps to settle before domain implementation

### Required

1. **Date scalar.** Activity deadlines and all-day calendar boundaries are dates,
   not datetimes. Add `date` through parser, SQL mapping, changeset, query outputs,
   codegen, agent schema and adapter tests; alternatively prove that validated ISO
   date text is sufficient. The former is preferred.
2. **External transport injection.** Decide how a worker receives a provider client
   without module-global state or plaintext secrets. Prefer a narrow runtime service
   contract with effect-gated access, analogous to `ctx.storage`.
3. **Safe message document.** Choose escaped plain text for slice one and define the
   future rich-text boundary before importing Odoo HTML.
4. **Mail worker queue.** Add `mail` to the app's configured worker queues and verify
   workspace composition refuses the module when the queue is missing.

### Deliberately not required for slice one

- Tenant-safe realtime streams remain an open Ket question. Chatter starts with SSR
  pagination plus bounded polling in its island; it does not depend on the current
  in-memory stream store.
- Transparent ORM tracking is not introduced as an undeclared hook. Activity
  completion and mail actions write explicit system messages. Business field
  tracking waits for a declared event/subscription seam.
- Recurring cron is not required. Scheduled reminder jobs carry versions and
  self-invalidate when the underlying reminder changes.

## 7. Core flows

### Post a Chatter message

1. target bridge verifies the record in current scope;
2. ensure the unique Thread;
3. create Message and attachment/mention joins;
4. resolve followers, subtype subscriptions, mentions and author exclusion;
5. create one Notification per recipient;
6. inbox notifications are immediately queryable;
7. if `mail_transport` is installed and the recipient prefers email, create
   Delivery rows and enqueue them in the same transaction.

Internal notes are hidden from external recipients by default. Mentioning an
external partner requires an explicit confirmation flag; KetSuite will not copy
Odoo's surprising implicit leak of an internal note through an external mention.

### Complete an Activity

1. compare assignee/manager authority;
2. create the completion Message with feedback and activity type;
3. move/link attachments to the message as required;
4. archive Activity and set `doneAt`;
5. create a chained next Activity if configured;
6. commit atomically and update the user's indicator on next read/poll.

### Create a Meeting Activity

1. schedule Activity through the target bridge;
2. `calendar_activity` creates Event and attendee rows in the same transaction;
3. store the optional event reference on Activity;
4. create invitation notifications;
5. `calendar_mail_transport` enqueues invitations if installed;
6. later edits use bridge functions and an explicit origin/version to prevent loops.

### Send email

1. render a template from an explicit snapshot or accept composed safe content;
2. write Message, Notification and Delivery rows;
3. enqueue `mail_transport.deliver` with `deliveryId` and version;
4. worker claims, CASes and sends with stable provider idempotency key;
5. success/failure updates Delivery and Notification;
6. provider webhook later reconciles delivered/bounced status.

### Receive email

1. verify provider signature before parsing content;
2. dedupe on provider event id and RFC Message-ID;
3. persist normalized InboundEnvelope and attachment metadata;
4. enqueue routing work if parsing/routing is non-trivial;
5. resolve an existing thread through signed reply token/References first;
6. otherwise resolve a model-specific alias through its bridge;
7. create an incoming Message or record a visible route failure;
8. notify followers except the author according to subtype preferences.

Unrouteable mail is retained for a bounded diagnostic period rather than silently
lost. It is not exposed as a general mailbox.

## 8. Delivery plan by pull request

### PR 0 — architecture proofs and prerequisites

- add and test the `date` scalar or record the validated-text decision;
- add a fake effect-gated outbound transport usable by jobs;
- prove transactional enqueue, retry, crash rescue and stable external idempotency;
- add the `mail` worker queue to the KetSuite app;
- record ADRs for target bridges, safe message bodies and provider secrets.

Exit: no business feature yet, but every high-risk framework seam has an executable
test rather than an assumption.

### PR 1 — headless Mail/Chatter core

- implement Thread, Message, Subtype, Follower, Mention, Notification,
  TrackingValue and attachment joins;
- implement typed operations for ensure-thread, post note/message, follow/unfollow,
  paginated timeline and inbox read state;
- enforce company scope, unique target thread, author exclusion and internal-note policy;
- add Odoo mapping fixtures for mail core.

Exit: headless tests can post and read a safe timeline and calculate inbox counts.

### PR 2 — Chatter backend and first target bridges

- build `mail_backend` Chatter/inbox screens and polling island;
- publish typed record joints in Product and Stock backend screens;
- add `product_mail_backend` and `stock_mail_backend` auto bridges;
- support message/note composer, followers, attachments and pagination;
- add sidebar inbox indicator and unread behavior.

Exit: a user can collaborate on a product and a transfer without Product or Stock
depending on Mail.

### PR 3 — Activity core and backend

- implement Type, Activity, Plan and PlanStep;
- schedule, reschedule, complete, cancel and chain activities;
- implement My Activities list/activity views and sidebar due counter;
- place planned activities in Chatter through the same bridges;
- cover Odoo 18/19 completed-activity import differences.

Exit: ownership, due-state and completion history work across Product and Stock targets.

### PR 4 — native Calendar and meeting bridge

- implement Event, Attendee, RSVP, Reminder, Recurrence and tags;
- deliver agenda first, then week/month screens as a calendar island;
- implement availability queries and all-day/timezone rules;
- implement `calendar_activity` link and synchronization;
- schedule versioned reminder jobs with a fake notification transport.

Exit: a Meeting Activity produces one coherent Event, reminders and completion trail.

### PR 5 — outbound transactional Email

- implement safe template rendering, Delivery and provider adapter contract;
- enqueue delivery in the message transaction;
- implement mail worker, CAS, retries, stable IDs and operator retry;
- reconcile provider delivered/bounced events;
- add queue/outbox screens and red failure state in Chatter;
- add `calendar_mail_transport` and use Calendar invitations and reminders as the first real producers.

Exit: killing a worker at each state transition loses no delivery request and does
not corrupt business state; provider-supported idempotency prevents duplicates.

### PR 6 — inbound replies and aliases

- signed provider webhook and dedupe;
- reply token/References routing to an existing thread;
- catchall and bounce handling;
- model-specific alias provider contract and one real alias bridge;
- bounded failed-route diagnostics and retention jobs;
- inbound attachments through Storage.

Exit: an external reply returns to the correct Chatter and an alias can create one
supported business record without dynamic undeclared model access.

### PR 7 — Odoo importer and cutover tooling

- import IDs through a stable namespace/map;
- migrate messages, followers, notifications, activities, calendar and attachments;
- import templates and alias configuration without secrets;
- reconcile row counts, orphan targets, missing partners and timezone conversions;
- support snapshot, delta, freeze/drain and read-only rollback procedure.

Exit: a representative Odoo 19 fixture migrates deterministically twice with the
same result, and all unresolved rows appear in a report.

### PR 8 — optional provider parity

- Google Calendar and Outlook bridges with OAuth secret storage;
- two-way sync IDs, cursors, conflict policy and loop suppression;
- provider reset/reconciliation tooling;
- raw SMTP/MIME bridge only if an explicit dependency or external gateway decision is approved;
- declared business-event seam for opt-in automatic field tracking.

## 9. Odoo migration map and policy

| Odoo | KetSuite | Policy |
| --- | --- | --- |
| `mail_message` | `mail.Message` | preserve parent, dates, author and message kind; sanitize body |
| `mail_followers` | `mail.Follower` | dedupe by thread/partner |
| follower subtype relation | `mail.FollowerSubtype` | explicit join |
| `mail_notification` | `mail.Notification` | preserve recipient/read/failure where meaningful |
| `mail_tracking_value` | `mail.TrackingValue` | normalized JSON snapshots |
| `mail_activity` | `activity.Activity` | active rows plus kept/archived done rows |
| `mail_activity_type` | `activity.Type` | map action/category/chaining vocabulary |
| activity plans/templates | `activity.Plan`/`PlanStep` | preserve sequence and offsets |
| `calendar_event` | `calendar.Event` | UTC instant plus source timezone/all-day dates |
| `calendar_attendee` | `calendar.Attendee` | normalize RSVP vocabulary |
| calendar alarm/recurrence | Reminder/Recurrence | report unsupported rules rather than approximate silently |
| `mail_mail` | `mail_transport.Delivery` | import pending/failed work; sent content already lives in Message |
| `mail_template` | `mail_transport.Template` | convert only supported expressions; report the rest |
| aliases/domains | Alias/AliasDomain | import names and routing, never credentials |
| `ir_attachment` | `storage.Attachment` | stream bytes, checksum, retain target mapping |

Numeric Odoo IDs become stable namespaced Ket IDs or are recorded in an explicit
`LegacyId` map. The importer never assumes that an integer ID is globally unique
across Odoo models.

For Odoo 18 and older, a completed Activity may no longer exist because completion
deleted it after posting the Chatter message. The importer keeps that message as
history and does not invent an Activity row it cannot reconstruct reliably.

## 10. Test matrix

### Contract and domain tests

- module graph, auto-install bridges, exact effects and missing worker queue refusal;
- company isolation and no generic cross-model thread read;
- follower/subtype/mention recipient resolution and author exclusion;
- internal note external-recipient policy;
- Activity state boundaries in user timezone and atomic completion/chaining;
- Calendar all-day, DST, recurrence exceptions and RSVP races;
- template snapshot behavior and HTML escaping.

### Durable job and fault tests

- enqueue rolls back with failed Message/Delivery transaction;
- concurrent unique enqueue produces one active job;
- worker crash before send, during send and after provider acceptance;
- lease expiry rescue, max-attempt discard and operator retry;
- stale reminder job no-ops after reschedule/cancel;
- disabled/removed module jobs are discarded visibly;
- queue pruning does not remove Delivery audit state;
- hot tenant does not starve another tenant's mail queue.

### HTTP and UI tests

- Chatter on Product and Stock through real authenticated HTTP;
- note/message/follow/attachment forms and pagination;
- activity list, sidebar badge and completion feedback;
- Calendar agenda/week/month navigation and RSVP link;
- outbound failure visible in Chatter;
- signed inbound reply and alias route;
- permission-gated menus and functions.

### Live integrations

- existing MinIO suite for inbound/outbound attachments;
- PostgreSQL concurrent claim and transactional notification;
- provider sandbox for idempotent send and bounce webhook;
- later Google/Outlook test tenants, never production accounts.

Every PR ends with `npm run verify`; live provider tests remain opt-in in the same
way as the current MinIO and PostgreSQL live suites.

## 11. Main risks and gates

| Risk | Gate before implementation |
| --- | --- |
| generic target leaks another domain's Chatter | two explicit target bridges and permission tests |
| duplicate external email after worker crash | provider idempotency proof or documented SMTP limitation |
| stored XSS from Chatter/inbound HTML | plain-text slice or reviewed sanitizer contract |
| timezone/recurrence corruption | date scalar and DST fixture matrix |
| queue status mistaken for business audit | separate Delivery model and pruning test |
| plaintext SMTP/OAuth secrets | runtime secret/transport decision |
| MIME parser becomes an unreviewed dependency | provider webhook first; explicit dependency ADR later |
| realtime design crosses tenant boundaries | polling first; no use of unresolved tenant stream path |
| automatic tracking recreates Odoo hidden hooks | defer until a declared event seam exists |

## 12. Recommended first vertical

The first implementation vertical should be narrower than “build all Mail”:

1. add `mail.Thread`, `mail.Message`, `mail.Notification` and `activity.Activity`;
2. attach them to `stock.Picking` through one bridge;
3. show Chatter plus planned activities on the transfer screen;
4. complete an activity and post its result atomically;
5. create an outbound Delivery with a fake transport and enqueue it in that same transaction;
6. crash and retry the worker under test.

That vertical exercises the two hard architectural boundaries—polymorphic target
authorization and durable external delivery—before Calendar UI, recurrence or MIME
parsing can hide mistakes behind volume.

## 13. Implementation evidence through PR 7

Completed on 2026-08-20:

Final integration verification on the baseline above reports 631 tests: 630
passed, zero failed and one live MinIO check skipped because the opt-in service
was not running. All 11 compile-time type assertions hold. The authenticated
Chrome run satisfies 11 interaction/security assertions across all nine screens.

- PR 0: strict `date` scalar, effect-gated outbound transport and durable retry/idempotency proof;
- PR 1: company-scoped Mail/Chatter domain, follower/subtype fan-out, internal-note disclosure policy,
  actor-owned inbox and authenticated HTTP E2E;
- PR 2: polling Chatter island, inbox screen/indicator, Product and Stock target bridges, attachment
  rendering, pagination and full browser interaction tests.
- PR 3: activity types/plans, actor-owned due work, Product and Stock activity bridges, atomic
  completion-to-Chatter with attachment preservation, retry-safe plan application, automatic chaining,
  record activity islands and a My Activities screen/indicator.
- PR 4: timezone-aware timed/all-day events, attendees/RSVP, availability, tags, bounded recurrence and
  explicit exceptions, stale-safe reminder jobs, the Meeting Activity bridge, plus Agenda/Week/Month
  islands with browser-created events.
- PR 5: safe allowlisted text/HTML templates, immutable Delivery snapshots, a mail queue state machine
  with CAS claims, stable provider idempotency keys, retry/terminal-failure handling, operator retry,
  deduplicated delivered/bounced reconciliation, Notification propagation, a Calendar invitation
  producer, Chatter delivery badges and the operational Outbox screen.
- PR 6: a dedicated `KET_WEBHOOK_SECRET`, path-bound HMAC signatures and replay window, provider-event
  dedupe, reply token and provider-References routing, conservative HTML-to-plain-text conversion,
  inbound attachment storage, bounce reconciliation, bounded failed-route retention, a concrete
  `stock.receipt` alias bridge and the inbound diagnostics screen.
- PR 7: a company-scoped Odoo source/run/identity-map ledger; atomic snapshot and checkpointed delta
  import for messages, tracking, followers, notifications, activity types/plans/history, Calendar,
  attachments, pending/failed mail, templates and alias domains/configuration; deterministic replay,
  secret stripping, exact recurrence refusal, timezone reconciliation and a read-only rollback manifest.
  The representative Odoo 19 fixture imports twice without duplicate target rows, reports two unresolved
  references, omits already-sent mail and leaves one pending delivery on the durable queue. The operational
  procedure is [the cutover runbook](07-odoo-collaboration-cutover.md).

The real-browser run exposed and fixed a framework mismatch: SSR emits no text node for `''`, while
hydration previously required one. A regression test now covers an initially empty hole becoming
content after hydration. Visual review also corrected dark-mode internal-note contrast and resolved
message authors through their user/partner identity.

Warm authenticated HTTP render benchmark, 30 samples per screen on the development machine:

| screen | mean | p50 | p95 | HTML |
| --- | ---: | ---: | ---: | ---: |
| Product collaboration | 5.59 ms | 5.17 ms | 9.24 ms | 28,615 B |
| Transfer collaboration | 4.40 ms | 4.01 ms | 5.79 ms | 27,464 B |
| My Activities | 2.63 ms | 2.50 ms | 3.63 ms | 19,646 B |
| Calendar Agenda | 2.04 ms | 1.95 ms | 3.15 ms | 12,802 B |
| Calendar Week | 2.00 ms | 1.98 ms | 2.90 ms | 14,494 B |
| Calendar Month | 2.37 ms | 2.29 ms | 3.08 ms | 23,117 B |
| Notification inbox | 2.97 ms | 2.61 ms | 5.05 ms | 14,328 B |
| Transactional outbox | 2.29 ms | 2.14 ms | 3.18 ms | 13,185 B |
| Inbound email log | 2.33 ms | 2.26 ms | 3.24 ms | 13,979 B |

The reproducible Chrome headless run records navigation and island-ready timings in
`docs/assets/odoo-collaboration/browser-e2e.json`. It logs in through the real session route, posts a
message and an internal note from the rendered composers, schedules and completes an Activity, verifies
an HTML-looking payload stays text, checks Chatter delivery states, and checks the due list, inbox and
transactional Outbox and inbound diagnostics. The latest interactive timings are recorded per screen,
including 199.3 ms for Agenda, 201.8 ms for Week, 227.0 ms for Month, 137.7 ms for Outbox and 99.7 ms
for the inbound email log. These are wall-clock browser readiness measurements, not server render time;
the matching navigation values are retained in the JSON evidence. Reproduce both evidence sets with:

```sh
npm run bench:collaboration
npm run e2e:collaboration
```

PR screenshots:

- [Product Chatter](assets/odoo-collaboration/product-chatter.png)
- [Transfer Chatter](assets/odoo-collaboration/transfer-chatter.png)
- [My Activities](assets/odoo-collaboration/my-activities.png)
- [Calendar Agenda](assets/odoo-collaboration/calendar-agenda.png)
- [Calendar Week](assets/odoo-collaboration/calendar-week.png)
- [Calendar Month](assets/odoo-collaboration/calendar-month.png)
- [Notification inbox](assets/odoo-collaboration/notification-inbox.png)
- [Transactional Outbox](assets/odoo-collaboration/transactional-outbox.png)
- [Inbound email log](assets/odoo-collaboration/inbound-email-log.png)

## 14. Optional provider parity disposition

PR 8 remains outside the required Odoo collaboration port. Google Calendar and
Microsoft Outlook synchronization need deployment-owned OAuth clients, a reviewed
secret-vault adapter and non-production provider tenants to prove cursor reset,
conflict and loop-suppression behavior. None were supplied for this worktree, so
the port does not add plaintext token rows, untested remote fetches or a fake
"connected" state.

The same gate keeps raw SMTP/MIME out: the durable Delivery boundary is complete,
but exactly-once provider acceptance can only be claimed by an injected transport
that honors its stable idempotency key. Automatic arbitrary-field tracking also
remains opt-in future work until business modules publish a declared event seam;
the imported `mail.TrackingValue` history and explicit Chatter posts do not create
hidden model hooks.

These are deliberate optional integrations, not gaps in the native Calendar,
Chatter, Activity, inbound email, transactional outbound email or Odoo cutover
acceptance criteria completed through PR 7.
