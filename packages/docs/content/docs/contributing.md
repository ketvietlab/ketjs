---
title: Contributing
description: Work on KetJS with explicit package ownership and focused verification.
group: Project evolution
order: 5
---

## Choose the repository

Framework changes belong here. KetSuite modules, its public design system and product clients belong in the KetSuite source. Application deployments adopt released framework versions from npm.

## Work from a feature branch

Use `feat/` or `fix/` branches from the integration line. Write source, commit messages and public technical documentation in English. See the canonical [AGENTS.md](https://github.com/ketvietlab/ketjs/blob/integration/AGENTS.md) for the full contribution rules.

## Verify the affected deployment

Identify the application's complete deployment composition before running checks. Run focused producer contract checks and the affected consumer behavior. Documentation-only changes need a content and diff check. Integration carries no CI; broad verification belongs to promotion into develop and release gates.

Do not substitute a successful package build for a test, browser check or deployed result. Report what was actually checked and what remains unverified.

## Document the contract

Update public guides and the affected package README with behavior changes. Shared views stay render-pure; browser effects live in disposable runtimes. The private documentation site has its own [development instructions](https://github.com/ketvietlab/ketjs/blob/integration/packages/docs/README.md).
