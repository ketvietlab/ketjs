# Agent rules

- Branch names must start with `feat/` or `fix/`. Do not use agent-specific prefixes such as `claude/` or `codex/`.
- Develop and test in the same scope: while implementing a change, run the targeted tests for the package, module, screen, or flow being changed.
- Do not run the full test suite as part of routine local development. The full suite is already configured in CI and runs when a pull request targets `develop`.
