# Agent rules

- Everything written into the repository or onto GitHub is in English: branch names, commit messages, pull request titles and descriptions, review comments, and issue comments. Vietnamese remains correct for product strings, user-facing copy, and the handoff documents written for a specific team; conversation with a maintainer follows whatever language they are using.
- Branch names must start with `feat/` or `fix/`. Do not use agent-specific prefixes such as `claude/` or `codex/`.
- Develop and test in the same scope: while implementing a change, run the targeted tests for the package, module, screen, or flow being changed.
- Feature pull requests carry no CI. Before pushing, run the tests for the part you changed — including its live-Postgres tests when it has them — plus the quality contracts in `verify.yml` (format, lint, terminology, build, zero-dep, doc snippets, types), and list the commands and results in the pull request description. Re-run them after review changes or a rebase.
- Do not run the full test suite as part of routine local development. The full suite runs in CI on the promotion pull request from `integration` into `develop` and on the release pull request into `master`.
- Every behavior, public contract, configuration, workflow, or architecture change must update the corresponding documentation in the same change. Use the documentation index below to find the owning page; update every affected page when a change crosses boundaries.
- All new or updated documentation pages belong under `docs/src/content/docs/`; never add documentation Markdown at the root of `docs/`. `docs/README.md` is reserved for maintaining the docs application, and existing root-level Markdown is legacy material to migrate into the content collection rather than extend.
- Every fenced code block in the documentation must begin with a language-valid location comment. Use `// File: path` for TypeScript, JavaScript, TSX, and JSONC; `# Run from: path` for shell commands; `%% File: path` for Mermaid; `{% comment %} File: path {% endcomment %}` for Liquid/KTL; `<!-- File: path -->` for Markdown and HTML; and `# File: path` for text, HTTP, and other plain examples. Use a concrete repository or example-project path, not a vague label. Run `npm --prefix docs run check:snippets` before handoff.

## Documentation index

| Change area | Documentation owner |
| --- | --- |
| Repository overview, onboarding links, and top-level developer commands | `README.md` |
| Documentation application, Starlight navigation, local docs workflow | `docs/README.md`, `docs/astro.config.mjs`, `docs/src/content/docs/getting-started.md` |
| Documentation landing page and guide discovery | `docs/src/content/docs/index.mdx` |
| Repository boundary and documentation architecture | `docs/src/content/docs/foundation/app-boundary.md`, `docs/src/content/docs/architecture/index.md` |
| KetJS overview, package selection, and first application | `docs/src/content/docs/ketjs/{index,quick-start}.md` |
| Workspaces, application composition, lifecycle, modules, discovery | `docs/src/content/docs/ketjs/{workspaces,app-lifecycle,modules,module-discovery}.md` |
| Models, scopes, queries, changesets, functions, effects, migrations | `docs/src/content/docs/ketjs/{models,data,functions,migrations}.md` |
| HTTP, OpenAPI, sessions, tenants, jobs, storage, transports, streams | `docs/src/content/docs/ketjs/{http,openapi,sessions-tenants,jobs,integrations}.md` |
| Operational logging, log drivers, event catalogue, redaction | `docs/src/content/docs/ketjs/logging.md` |
| Forms, rendering, islands, themes, menus, localization, reports | `docs/src/content/docs/ketjs/{form-validation,rendering,themes,menus-i18n,reports}.md` |
| Testing, CLI, configuration, deployment, releases, public API | `docs/src/content/docs/ketjs/{testing,cli-config,deployment,releasing,api}.md` |
| Cross-cutting architecture decisions and unresolved design questions | `docs/src/content/docs/architecture/{decisions,open-questions}.md` |
| Operations and benchmark policy | `docs/src/content/docs/operations/{index,benchmarks}.md` |

