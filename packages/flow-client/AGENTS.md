# Flow core client

Public MIT client for KetSuite deployments. `client/` is the existing JavaScript
application imported from ketviet, retained byte-for-byte except subsequent reviewed
fixes. It composes flow-ui. Design work follows [Két Design System](../../skills/ket-design-system/SKILL.md).

This import is a documented compatibility boundary: the legacy JavaScript application
is syntax/lint/runtime tested, not included in the repository's strict TypeScript
program. Do not claim it is fully type checked. New typed server integration belongs
in KetSuite modules; migrating the existing JS model to typed API records is later work.
The public build copies `client/` into dist atomically; no private package is required.

`atlas/` and its fixtures are development-only. Never import them from client or a
production deployment. Every runtime dependency is public and declared. Private
features enter only through EXTENSIONS.md, never by importing a private package.

Run package tests, the clean-install pack smoke, and root checks. Preserve core-only
navigation and core write behavior; permission enforcement remains on the server.
