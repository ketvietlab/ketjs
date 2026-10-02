# Source and scope

Flow core is imported from ketviet's `packages/flow-client` after the core/pro
separation (client/Atlas implementation through local commit `da799c09`). The owner
approved MIT licensing and distribution inside public KetJS/KetSuite on 2026-09-28.
Private feature modules, UI components, stores and message catalogs were excluded.

The imported application remains JavaScript. Changes made during import are formatting,
unused import cleanup, fixture callback lint fixes, package paths and single-module
identity for source/Atlas/consumer tests. The public build and tests need no private
checkout. Production endpoint adapters and real pro schemas/migrations are later work;
this import does not move a mock store into a server module.

The existing KetSuite Flow module and its migrations remain unchanged. Future paid
schemas must live in a private module with its own migration history; no paid columns
were added to the public core by this extraction.
