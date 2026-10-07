---
title: "Document and inspect API contracts"
description: "Distinguish function signatures from route metadata and keep generated API documentation aligned with deployment."
stage: "Build the API"
duration: 30
lab: "Node terminal"
order: 20
---

Before you start: complete [Expose the Todo API through HTTP](/learn/http-api/), or make sure you can pass its checkpoint.

## Start with the consumer's needs

Write down the Todo collection's three operations: request fields, response fields, status codes and authentication expectations. The hand-written route facade works without OpenAPI, but a client should not need to read handler source to discover its contract.

Function `input` and `output` declarations describe a callable operation. HTTP metadata describes how that operation is exposed through a method and path. Those are related contracts with different responsibilities.

## Inspect the framework contract format

Read the route metadata example in [HTTP contracts and OpenAPI](/docs/openapi/). Add metadata beside the route declaration, using the public contract supported by this version. Keep the declaration with the module that owns the route; do not create a second unrelated catalogue of paths.

The completed Todo lab deliberately keeps its small facade readable. This is an extension exercise: it does not claim to ship an OpenAPI integration merely because the runtime routes exist.

## Verify the generated surface

Generate the OpenAPI document for the selected deployment using the documented API. Check that a path parameter is marked required, the create body names only accepted fields, and a successful create is described as 201. Include error outcomes that a caller can actually receive.

Do not put secrets, example production credentials or internal exception stacks in examples. A fictional company and task are enough to explain a request.

## Check anonymous and internal operations

An operation visible in a manifest is not necessarily an anonymous public endpoint. Inspect audience selection and grants before exposing generic function transport. If a function is internal, leave it internal even when other functions in the same module are public.

## Design a contract review

Compare the generated document before and after changing the title length rule or response projection. Decide whether the change is compatible with existing callers. Put that review beside tests that exercise the real HTTP response so a document cannot drift independently.

## Checkpoint

Produce a route-contract checklist and identify which metadata comes from a function versus the HTTP facade. Validate generated output for your extension.

## Practice on your own

Add one API example for a validation failure and check it against an actual response. Do not invent a status code solely because another framework uses it.

## Reference

For the complete API contract, read [Openapi](/docs/openapi/).
