---
title: Release notes
description: The coordinated KetJS 0.1.41 release and its package boundaries.
group: Prologue
order: 1
---

## Current release: 0.1.41

KetJS releases five packages together: View, View Tools, Create View, the core framework and the optional PostgreSQL adapter. Keep the framework packages used by an application on the same version.

From `0.1.41`, KetSuite, its design system, Flow and website clients are maintained and released from the KetSuite source. They are consumers of the framework rather than packages built in this repository. Their last release from this repository was `0.1.40`.

## Preview stability

The `0.1` line is preview software. Read the [upgrade guide](/docs/upgrading/) before updating existing application code or datastores. A shared package version does not guarantee that an application upgrade needs no migration.

## Source checkout additions

The current source checkout adds `definePages()` collections, Open Graph `property` metadata, safely serialized JSON-LD, external head scripts and TSX starter files. These tooling/scaffold contracts are pending the next release and are not part of the published 0.1.41 packages. The docs site uses local file dependencies to exercise them.

## Track changes

Published tags and release descriptions are on [GitHub Releases](https://github.com/ketvietlab/ketjs/releases). The source repository's current work can include contracts that are not published yet; source-only contracts are labelled in the guides.

Start a new application with [Installation](/docs/quick-start/). Release maintainers should use [Publishing packages](/docs/releasing/).
