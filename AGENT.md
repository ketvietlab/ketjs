# Agent rules

- Everything written into the repository or onto GitHub is in English: branch names, commit messages, pull request titles and descriptions, review comments, and issue comments. Vietnamese remains correct for product strings, user-facing copy, and the handoff documents written for a specific team; conversation with a maintainer follows whatever language they are using.
- Branch names must start with `feat/` or `fix/`. Do not use agent-specific prefixes such as `claude/` or `codex/`.
- Develop and test in the same scope: while implementing a change, run the targeted tests for the package, module, screen, or flow being changed.
- Do not run the full test suite as part of routine local development. The full suite is already configured in CI and runs when a pull request targets `develop`.
- Every style change must be verified in a real browser at desktop and mobile widths for every affected locale and screen state. Check horizontal gaps between adjacent controls, vertical spacing at header/tab/body boundaries, identical body padding across sibling tabs, overflow, and that hidden or empty elements occupy zero layout space. Record or update visual evidence before considering the style work complete.
- Every behavior, public contract, configuration, workflow, or architecture change must update the corresponding documentation in the same change. Use the documentation index below to find the owning page; update every affected page when a change crosses boundaries.
- All new or updated documentation pages belong under `docs/src/content/docs/`; never add documentation Markdown at the root of `docs/`. `docs/README.md` is reserved for maintaining the docs application, and existing root-level Markdown is legacy material to migrate into the content collection rather than extend.
- Every fenced code block in the documentation must begin with a language-valid location comment. Use `// File: path` for TypeScript, JavaScript, TSX, and JSONC; `# Run from: path` for shell commands; `%% File: path` for Mermaid; `{% comment %} File: path {% endcomment %}` for Liquid/KTL; `<!-- File: path -->` for Markdown and HTML; and `# File: path` for text, HTTP, and other plain examples. Use a concrete repository or example-project path, not a vague label. Run `npm --prefix docs run check:snippets` before handoff.

## Documentation index

| Change area | Documentation owner |
| --- | --- |
| Repository overview, onboarding links, and top-level developer commands | `README.md` |
| Documentation application, Starlight navigation, local docs workflow | `docs/README.md`, `docs/src/content/docs/getting-started.md` |
| Documentation landing page and guide discovery | `docs/src/content/docs/index.mdx` |
| Repository boundary and documentation architecture | `docs/src/content/docs/foundation/app-boundary.md`, `docs/src/content/docs/architecture/index.md` |
| KetJS overview, package selection, and first application | `docs/src/content/docs/ketjs/{index,quick-start}.md` |
| Workspaces, application composition, lifecycle, modules, discovery | `docs/src/content/docs/ketjs/{workspaces,app-lifecycle,modules,module-discovery}.md` |
| Models, scopes, queries, changesets, functions, effects, migrations | `docs/src/content/docs/ketjs/{models,data,functions,migrations}.md` |
| HTTP, OpenAPI, sessions, tenants, jobs, storage, transports, streams | `docs/src/content/docs/ketjs/{http,openapi,sessions-tenants,jobs,integrations}.md` |
| Forms, rendering, islands, themes, menus, localization, reports | `docs/src/content/docs/ketjs/{form-validation,rendering,themes,menus-i18n,reports}.md` |
| Testing, CLI, configuration, deployment, releases, public API | `docs/src/content/docs/ketjs/{testing,cli-config,deployment,releasing,api}.md` |
| KetSuite overview, first application, composition, module ownership | `docs/src/content/docs/ketsuite/{index,quick-start,architecture,module-development}.md` |
| KetSuite backend UI, security, data scope, testing | `docs/src/content/docs/ketsuite/{backend-development,security-scope,testing}.md` |
| KetSuite Channel API and generated customer contract | `docs/src/content/docs/ketsuite/channel-api.md`, `docs/src/content/docs/ketsuite/channel-api-reference.mdx` |
| KetSuite identity and organization modules | `docs/src/content/docs/ketsuite/{address,partner,company-branch,authentication-users,oauth-oidc}.md` |
| KetSuite CRM, loyalty, and Vietnam accounting behavior | `docs/src/content/docs/ketsuite/{crm,loyalty,accounting-tt99}.md` |
| Cross-cutting architecture decisions and unresolved design questions | `docs/src/content/docs/architecture/{decisions,open-questions}.md` |
| Operations and benchmark policy | `docs/src/content/docs/operations/{index,benchmarks}.md`, `docs/src/content/docs/ketsuite/benchmarks/` |
| Team-specific integration contracts | `docs/src/content/docs/handoffs/` |
