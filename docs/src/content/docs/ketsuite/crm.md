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
a record or counting duplicates:

- no actor — a job, a fixture, the seed — sees everything;
- a superuser sees everything;
- everyone else sees the cases they are assigned, the cases they created, and the cases held by a
  team they are an active member of.

The list, group and duplicate queries push those three clauses into SQL, so a case that appears in a
list is a case the detail screen will open. Commands re-check the same audience before they write.

## Assignment

A case is assigned inside its team. `crm.case.assign` takes an explicit user, or falls through to the
team's `assignmentMode`:

- `manual` — nobody is chosen automatically;
- `round_robin` — the team's cursor walks its active members in `sequence` order;
- `capacity` — the member with the most headroom against their `capacity` wins.

Both routing modes read `TeamMember`, which is managed from **Configuration → Team members**. A team
with no members can only be assigned by hand.

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

- **Pipeline** — a kanban board, one column per stage, with drag-and-drop and a select as the
  no-JavaScript fallback. Cards carry the amount, the owner and a priority stripe; a column that holds
  more than it shows links to the same stage in the list.
- **Cases** — the shared list chrome: search, filters, grouping, saved state in the URL.
- **Record workspace** — duplicates, the record form, and the commands that were previously reachable
  only over the API: move, assign, merge, and marking a case lost with a reason. Tabs for sales
  (figures and quotations), activities (open work, meetings, history) and the timeline.
- **Planner** — CRM activities only, each linked back to its case, with complete and cancel on the row.
- **Leaderboard** — standings, recalculated on request.
- **Configuration** — teams, team members, stages, tags, assignment rules and scoring rules; each row
  can be edited and archived, not only created.

Relational fields — partner, owner, team, stage, tags, merge source, quotation product — are pickers
that search server-side and, where it makes sense, create the missing record inline. Fields over a
small fixed vocabulary — kind, priority, warehouse, activity type, plan — stay native selects.

Every mutating admin route refuses a cross-origin POST.

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
