# Két Design System

An agent skill for Két ERP components, typography, spacing, surface/border levels,
responsive behavior and verification. Keeps Két colours and Lucide while pinning
control/type dimensions to Polaris React 13.9.5 / tokens 9.4.2.

## Install

Node.js 22 or newer. From the project where the agent will work:

```sh
npx @ketvietlab/ket-design-system-skill@latest
```

This installs `.agents/skills/ket-design-system`. To install for every project:

```sh
npx @ketvietlab/ket-design-system-skill@latest --global
```

For another agent's skill directory:

```sh
npx @ketvietlab/ket-design-system-skill@latest --dir .claude/skills
npx @ketvietlab/ket-design-system-skill@latest --dir .cursor/skills
```

Invoke **Két Design System**, or `$ket-design-system`, and describe the screen/task.
The agent may need to reload its skill list. The installer does not alter project
instructions or install the UI library. Repeating an unchanged install is safe.
Edited/unmanaged installations require `--force`; the old directory is retained
as a sibling backup. Unrelated files are preserved.

When invoked, this is the highest-priority **repository design** guidance. Explicit
user and platform instructions, security and unrelated engineering rules still apply.
The canonical rules are in [SKILL.md](SKILL.md) and its linked references; this README
describes installation, not another set of design rules.

## Package development

This zero-dependency skill is versioned independently of the runtime workspaces.
It lives under `skills/` so publishing it does not release the nine runtime packages.
From the repository root:

```sh
node skills/ket-design-system/bin/install.mjs --dir /tmp/ket-skill-review
npm pack ./skills/ket-design-system --pack-destination /tmp
```

Inspect the archive and test an `npx --package <archive> ket-design-system` install in
an empty temporary project before publishing this package. No lifecycle install
scripts are shipped. Publish only when the user requests it, after the requested
screen review and normal npm authentication.
