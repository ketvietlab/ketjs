---
title: CRM
description: KetSuite CRM modules, the case model, record visibility, lead capture, and test evidence.
---

# CRM

KetSuite CRM is an open-source sales application for leads and opportunities. One record type — the
case — moves through a stage pipeline, carries its own conversation and activities, and turns into a
quotation when it is won.

## Modules

- `crm`: cases, lead conversion, stages, teams, assignment, scoring, tags, activities and timeline.
- `crm_staff_channel`: audience-scoped pipeline reads and explicit transition, assignment, and mark-won
  commands for the Staff Channel API.
- `crm_sale`: quotations written from an opportunity, and the products they may be written for.
- `crm_backend`: pipeline board, record workspace, planner, leaderboard and configuration. Auto-installs
  once `backend` is present.
- `crm_website`: the public lead-capture form.

`crm` depends on `company`, `partner`, `user`, `mail`, `activity` and `calendar`. A headless
deployment gets the domain and its functions with no admin UI.

## The case

A `Case` is a lead or an opportunity — the same row, distinguished by `kind`, so converting one keeps
its history, its conversation and its id. Money, probability and the lost reason live in a
`SalesDetail` beside it, which is what lets a lead exist before anyone has put a number on it.

```mermaid
%% File: docs/src/content/docs/ketsuite/crm.md
flowchart LR
  subgraph Pipeline["Per legal entity"]
    T["Team"]
    TM["TeamMember<br/>unique company + team + user"]
    AG["AccessGrant<br/>view, edit, assign scopes"]
    S["Stage<br/>allowedKinds, terminalState"]
    C["Case<br/>lead | opportunity"]
    SD["SalesDetail<br/>unique company + case"]
    TAG["Tag"]
    CT["CaseTag"]
    TL["TimelineEntry"]
    M["Message"]
    AL["ActivityLink"]
    CL["CalendarLink"]

    T -->|has many| TM
    C -->|stage| S
    C -->|team| T
    AG -->|limits access to| C
    C -->|has one| SD
    C -->|has many| CT
    CT -->|tag| TAG
    C -->|has many| TL
    C -->|has many| M
    C -->|has many| AL
    C -->|has many| CL
    C -->|mergedInto| C
  end
```

`terminalState` lives on the stage, not on the case: moving a case into a stage marked `won` closes
it and stamps `closedAt`, and moving it back into an open stage clears the date again. Reporting
reads that one field for cycle time.

## Who sees which case

Every read resolves one audience and applies it the same way, whether the caller is listing, opening
a record or counting duplicates. Company isolation is enforced by the data layer before this record
policy runs:

- no actor — a job, a fixture, the seed — sees everything;
- a superuser sees everything;
- an agent sees cases assigned to them plus unassigned work in their active team queues;
- a team leader sees assigned and unassigned cases in teams they lead;
- an active `AccessGrant` may independently widen `viewScope`, `editScope`, or `assignScope` from
  `none` through `self`, `team`, and `company`.

Creating a record does not grant permanent access after somebody else owns it. List, group, summary,
and duplicate queries push the audience clauses into SQL, so a filter can only narrow a permitted
set. Commands resolve the appropriate action again before they write; knowing a record id does not
bypass the policy.

The Staff Channel API keeps that same audience boundary. `GET /api/staff/v1/crm/leads` provides bounded
search, kind and outcome filters with an opaque cursor; `GET /api/staff/v1/crm/leads/{id}` provides a narrow
detail and the next pending activity. Neither projection carries raw email or phone fields, internal
timeline/messages, attachments, or option lists. The detail carries CRM's real integer version, and the
transition, claim, reassign, and terminal-state routes pass it straight to the existing domain commands. Those commands also
require the bootstrap CSRF token and an `Idempotency-Key`, isolate replay state by company, actor, and command,
and return the refreshed safe projection with its new integer ETag. Create, mark-lost, and activity commands
stay unpublished until their path or request-shape mismatch can be resolved without inventing behavior.

## Assignment

A case is assigned inside its team. `crm.case.assign` is the initial assignment and queue-claim
command; it does not change an already-owned record. For system routing it takes an explicit user,
or falls through to the team's `assignmentMode`:

- `manual` — nobody is chosen automatically;
- `round_robin` — the team's cursor walks its active members in `sequence` order;
- `capacity` — the member with the most headroom against their `capacity` wins.

Both routing modes read `TeamMember`, which is managed from **Configuration → Team members**. A team
with no members can only be assigned by hand. An ordinary agent can atomically claim only unassigned
work in one of their queues and can claim it only for themselves.

`crm.case.reassign` is the separate ownership-transfer command. It requires the current `version`, an
idempotency key, an active target team and member, and one of the documented business reasons. The
`manual_correction` reason also requires a note. A successful transfer increments the version and
writes an immutable timeline entry containing the previous and new team and assignee. Retrying the
same key replays the result; a stale version fails without changing the record.

## Scoring and the leaderboard

`ScoreRule` rows describe what a case is worth: a field, an operator (`eq`, `contains`, `present`,
`gte`), a value and a number of points. Saving a case enqueues `crm.score`, so the figure follows the
record rather than waiting for someone to press a button; `crm.case.refreshScore` recomputes on
demand. The scoring write neither bumps `version` nor overwrites a concurrent edit, so a form left
open stays valid.

Closing a case enqueues `crm.gamification` for its owner, which restates one row of the leaderboard
from counting queries. **CRM → Leaderboard** also recalculates the whole table on request.

## Duplicates and merging

The record workspace lists cases that share an email, a phone or a name with the one being edited,
each with a one-click merge. Phones are matched on `phoneDigits`, a normalised copy written beside
the number a user typed, so `090 123 4567` and `0901234567` are one number. Two different dialling
forms of the same number — `+84 90…` against `090…` — are not: normalising a country prefix is a
dialling-plan question this module does not answer.

A merge archives the source, points `mergedIntoId` at the target and moves the tags, notes,
activities, meetings and timeline across. The target's own figures win; the source only fills a
blank. A record that has already been merged or archived cannot be merged again.

## Lead capture from the website

`/contact/sales` is anonymous and writes into the company the site is served under. Three things
follow from that:

- **the company must exist.** Writes are pinned to `scope.company`, and a scope naming a company that
  was never created discards them. The endpoint establishes this first and answers
  `crm_website.error.inboxUnavailable` rather than failing later on an empty stage table.
- **the visitor never names the record.** The case id is derived inside a `website-lead:` namespace,
  so a submission is idempotent without being able to address a case that already exists.
- **submissions are rate limited**, per source and per email address, in a tenant-wide table. A hidden
  field a browser leaves empty catches the least careful scripts.

Under multi-tenancy the anonymous company comes from the deployment: a tenant subdomain, the
`X-Ket-Company` header, or `sessions.anonymous` in the app declaration.

## Company scope

Case data is company scoped, and the seed rows are too. Ids are the primary key across the whole
tenant, so the first company to be seeded takes `crm-stage-new` and every company after it takes
`<company>:crm-stage-new`; `seededId` resolves whichever of the two a company actually holds. Without
that split the second company in a tenant silently received no stages at all and every case it tried
to create was refused.

## Backend screens

- **Pipeline** — a kanban board, one column per stage, under four figures counted over the same
  filter the columns are: open records, total value, weighted value and overdue activities. Filtering
  is the shared list chrome — search, team, "mine", and a switch to the same records as a list — so
  the header and the cards always agree. A column head carries its count, the share of its money the
  forecast counts, and that money; its menu creates a record in that stage or opens the stage in the
  list. A card carries the party, its tags, the amount and probability, the next activity with its due
  date in red when it is late, and the owner. Moving is drag-and-drop, with a per-card disclosure
  holding the stage select and a real POST as the no-JavaScript fallback.
- **Cases** — the shared list chrome: search, filters, grouping, saved state in the URL.
- **Record workspace** — duplicates, the record form, and the commands that were previously reachable
  only over the API: move, assign, merge, and marking a case lost with a reason. Tabs for sales
  (figures and quotations), activities (open work, meetings, history) and the timeline.
- **Planner** — CRM activities only, each linked back to its case, with complete and cancel on the row.
- **Leaderboard** — standings, recalculated on request.
- **Configuration** — teams, team members, stages, tags, assignment rules and scoring rules; each row
  can be edited and archived, not only created.

All URL-owned CRM overlays use centered dialogs on desktop, including long configuration forms and
the activity scheduler. On narrow screens the shared dialog contract expands them to the full viewport;
CRM does not use right-side sheets.

The board's figures come from `crm.pipeline.summary`, which takes the screen's filters and answers
per-stage counts and amounts plus the four totals. Every column keeps its own figures, including Won
and Lost, because that is what a column head states; the four above the board count only the stages
that are still open, so winning a deal does not make the pipeline total climb. Counts come from SQL and are exact; the amounts
need `crm.SalesDetail` for every matching case, so past five thousand of them the function reports
`partial` and the screen drops the two money cards rather than showing the total of a subset. A role
that predates the function still gets the board — the header simply has nothing to state.

Relational fields — partner, owner, team, stage, tags, merge source, quotation product — are pickers
that search server-side and, where it makes sense, create the missing record inline. Fields over a
small fixed vocabulary — kind, priority, warehouse, activity type, plan — stay native selects.

Every mutating admin route refuses a cross-origin POST.

## Building on the case

`crm.Case` is a shared header, and a module that depends on the CRM may store its own `kind` on it —
a support ticket, a warranty claim, whatever that module is for. The CRM's own screens are scoped to
the kinds it owns: a foreign kind does not appear in the case list, its count, its grouping or the
duplicate finder, and `case.get` answers `null` for it so the record workspace does not claim a row
whose `case.save` would refuse it.

The owning module answers for those rows through its own functions and screens. `crmOwnedKinds()` and
`crmOwnsKind()` are exported so an extension can align with the same boundary, alongside the helpers
it needs to write one: `crmSaveCase`, `crmCaseAudience`, `crmCanReadCase`, `crmVisibleCases`,
`crmSerializeCaseList`, `crmSeededId` and `crmAddTimeline`.

`receiveAttachment` is exported for the same reason: an extension whose records carry photographs
should not reimplement streaming, upload limits, checksums and object keys — that is what `storage`
is for.

## Scope boundary

The OSS modules do not contain support tickets, SLA, complaints, knowledge base, canned responses,
post-sale fulfillment, Customer Care follow-up, outcome tracking, customer support portal or reseller
care. Deployments can provide those capabilities from a private extension without changing the public
lead/opportunity domain.

The public extension surface includes CRM domain helpers, Sale function specs for transactional
composition, and backend form/attachment/modal primitives. These are neutral extension contracts and
contain no Customer Care behavior.

## Verification

```bash
# Run from: /path/to/ketjs
npm run build
node --test .build/test/crm-e2e.test.js .build/test/crm-ux.test.js .build/test/crm-i18n.test.js
npm run bench:crm
KET_BENCH_DRIVER=postgres KET_BENCH_PG='postgres://USER:PASSWORD@HOST:PORT/postgres' npm run bench:crm
```

For a browser pass over the screens, seed a throwaway database and serve it:

```bash
# Run from: /path/to/ketjs
KET_VISUAL_SQLITE=/tmp/crm-visual.db npm run visual:crm:seed
```

The seed prints the sign-in it created. Point the server at that file and open `/admin/crm/pipeline`.
