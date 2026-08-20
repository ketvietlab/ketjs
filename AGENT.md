# Agent rules

- Branch names must start with `feat/` or `fix/`. Do not use agent-specific prefixes such as `claude/` or `codex/`.
- Develop and test in the same scope: while implementing a change, run the targeted tests for the package, module, screen, or flow being changed.
- Do not run the full test suite as part of routine local development. The full suite is already configured in CI and runs when a pull request targets `develop`.
- Every style change must be verified in a real browser at desktop and mobile widths for every affected locale and screen state. Check horizontal gaps between adjacent controls, vertical spacing at header/tab/body boundaries, identical body padding across sibling tabs, overflow, and that hidden or empty elements occupy zero layout space. Record or update visual evidence before considering the style work complete.
- Any change that affects the KetJS framework must include the corresponding update to the KetJS framework documentation under `docs/src/content/docs/ketjs/`. Do not edit KetSuite documentation yet; that section is intentionally deferred until KetSuite is complete.
