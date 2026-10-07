---
title: "Compose server rendering and themes"
description: "Choose between trusted TSX views and KTL theme presentation while preserving browser lifecycle and server permissions."
stage: "Present the application"
duration: 40
lab: "Local server extension"
order: 24
---

Before you start: complete [Grant operations and bound their effects](/learn/authorization/), or make sure you can pass its checkpoint.

## Choose the presentation owner

The Todo API lab is headless. Adding a server-rendered application requires a page/data projection and a presentation composition. Trusted application views can use ketjs-view TSX; a theme can supply KTL templates, CSS and browser assets.

Keep data access in the declared server operation. Pass a deliberate, serializable projection into rendering. Do not open a database from a shared TSX component or let a theme template become a second business-logic layer.

## Follow one page through the request

Sketch a task-detail route: resolve request identity, call a permitted operation, obtain a projected task, render the page, and hydrate a small completion island. Identify the owner of each step before writing the template.

For the first extension, use the rendering reference's TSX page pattern. Keep the page meaningful without JavaScript, then add the island for the completion action. Test both a direct request and a later browser interaction.

## Understand the theme boundary

A theme may contain browser JavaScript. The KTL server expression language is data-oriented; that is separate from a theme loading a browser script for navigation or a carousel. The theme does not gain permission to register server models, functions or jobs merely because it owns presentation.

Normal modules own registered islands and browser behaviors. A theme can place those capabilities and provide their visual context. Browser effects still need a lifecycle and cleanup.

## Keep initial output deterministic

The server and browser must agree on the island's initial props. Do not put current browser time, random browser-only values or localStorage reads in the shared render. Use mount-time enhancement after hydration for those values.

## Verify the extension

Inspect page source for the task content, then use the UI to complete it. Disable JavaScript and check that navigation and the server-rendered information remain usable. Deny the underlying operation and confirm the presentation cannot bypass the denial.

## Checkpoint

Produce a page ownership diagram and identify where TSX, KTL, server data and browser effects execute.

## Practice on your own

Create a second visual theme for the same projected data. Keep domain functions and grants identical; compare only the presentation contract.

## Reference

For the complete API contract, read [Themes](/docs/themes/).
