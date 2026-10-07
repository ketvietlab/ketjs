---
title: "Finish and review your task application"
description: "Combine the course into an application and assess it against concrete frontend, data, security and operations requirements."
stage: "Finish the path"
duration: 60
lab: "Browser + Node terminal"
order: 33
---

Before you start: complete [Prepare an evaluation deployment and upgrade](/learn/deployment/), or make sure you can pass its checkpoint.

## Define the finished workflow

A learner can open the website, list their company's tasks, add a validated task, complete it directly or through a background job, and see useful loading/error states. The source explains which behavior runs in the browser and which runs in Node.

The downloaded projects are reference building blocks. Finishing this capstone means connecting the pieces and implementing the security/provider extensions appropriate to your chosen deployment; it is not accomplished by marking every article complete.

## Frontend acceptance

Use TSX, native labels and links, stable row keys and disposable browser effects. Initial HTML should contain meaningful page content. Errors preserve drafts, pending state prevents duplicate submissions, and mobile controls remain operable. Inspect the generated website as well as the development server.

## Backend acceptance

The module owns its model and named operations. Inputs are checked, writable fields are deliberate, effects are narrow, and HTTP routes preserve request context. Tests cover valid and invalid requests, missing records, company isolation and the worker outcome.

## Security and data acceptance

Replace development identity conveniences before any shared evaluation environment. Test allowed and denied identities, establish tenant selection where applicable, and keep secrets out of browser bundles and logs. Review the physical schema and backup/restore process.

## Operations acceptance

Record the exact framework version and selected deployment. Run the appropriate migration step, start the HTTP and worker roles, inspect records, and verify restart behavior. Keep static hosting and Node hosting responsibilities explicit.

## Present your evidence

Capture the completed UI in a browser. If you publish the image with your learning journal, convert it to WebP, include alt text and dimensions, and avoid real personal data. Attach the commands and outcomes from your scoped checks. A screenshot proves appearance; a passing HTTP test proves a different part of the system.

## Choose a next project

A booking system exercises transactions and concurrency. An internal approval tool exercises grants and workflow. A content site exercises static generation, metadata and islands. Pick the project whose constraints interest you, then reuse the framework contracts you can now explain.

Return to [the reference documentation](/docs/) for detailed API contracts and [the playground](/playground/) for small experiments. Keep the distinction: the learning path teaches a sequence; the reference describes the full contract of each feature.

## Checkpoint

Review the application against each acceptance group and record what is implemented, tested, deliberately omitted or still uncertain.

## Practice on your own

Ask another developer to run the project using only your README. Fix every hidden setup assumption they encounter.

## Reference

For the complete API contract, read [Testing](/docs/testing/).
