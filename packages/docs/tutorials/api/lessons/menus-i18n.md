---
title: "Build navigation and translated messages"
description: "Keep message keys and permission-aware navigation beside the module that owns their meaning."
stage: "Present the application"
duration: 30
lab: "Local server extension"
order: 25
---

Before you start: complete [Compose server rendering and themes](/learn/themes/), or make sure you can pass its checkpoint.

## Replace hard-coded application text

The lab already declares an English application title. Add keys for the task list, create action, completion action and empty state. Add a second locale using the same keys. Stable keys describe meaning; they should not be generated from the current English sentence.

Keep labels in the module's message catalogue and supply translated values to views. A component should receive its label instead of importing one application's messages itself.

## Declare a navigation entry

Follow the menu contract to add a task list entry owned by the Todo module. Give it a stable ID, path and label key. If a child entry belongs under a menu contributed by another module, declare the dependency and parent explicitly.

A menu's `needs` relationship describes the operation required to expose that destination. Build the menu for the current viewer's grant set and translation context. A hidden entry is a presentation result; the destination must still enforce its permission on the server.

## Test language and permission independently

Use two locales and the reader/editor role matrix from the authorization lesson. A reader should still get a translated list link while an editor-only action remains unavailable. Missing translations should be observable during development rather than silently escaping review.

Use pseudo-locale or deliberately long translations to inspect wrapping and mobile navigation. Do not shrink text until it fits; choose an appropriate component and layout behavior.

## Localize values too

Dates, amounts and counts need formatting through the request's locale context. Storing a translated date string in a database makes later formatting and sorting difficult. Store a typed value and format it at the presentation boundary.

## Keep routes stable

Changing the label from “Tasks” to “Todos” should not unexpectedly change saved links. If you later localize paths, make the routing and canonical URL policy explicit and test direct navigation in each locale.

## Checkpoint

One task-list destination renders with two locales and the intended viewer grants. The server still denies unauthorized direct calls.

## Practice on your own

Add a pluralized remaining-task message and a long translation. Check empty, one-item and many-item states at mobile width.

## Reference

For the complete API contract, read [Menus I18N](/docs/menus-i18n/).
