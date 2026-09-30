# Changelog

## Unreleased

- Enhance DatePicker and DateRangePicker with accessible draft calendars, seven Vietnamese quick ranges, civil-date arithmetic, keyboard navigation and responsive month layouts. DatePicker retains native validation/fallback; DateRangePicker uses one visible range field with a preset select inside its calendar and two ISO form values. Both calendars fill mobile screens; ranges scroll vertically through multiple months. Add the `/dates` playground.

- Add `/primitives`, a render-pure harness covering every primitive with theme, density, state and content-pressure comparisons.
- Keep notice icons beside wrapping copy and place actions below it in narrow containers. Preserve icon, spinner, tag-removal and progress-value geometry with long content.
- Align checkbox/radio controls with field edges and vertical option-group labels with their first option.
- Give Select a consistent chevron inset and room for long values while retaining its native picker, keyboard and validation semantics.

- Keep explicit Stack gap variants authoritative when legacy KetSuite controls CSS is loaded.

- Backport the integration page-title contract (f6c5f413): shared 24px title token, 17px below tablet width, remove the compact operational list exception so every page uses the same title scale.

- Keep modal titles at the xl type step and section/nested surface headings at lg so headings remain distinct from body content.

- Badge and Tag now use the full pill radius, matching CountBadge across all themes and tones.

## 0.1.14 — KetSuite application navigation

- Migrated the KetSuite administration shell to the public `AppNavigation` contract.
- Kept dense desktop navigation scrollable with a pinned account footer and exposed the same hierarchy through a left-side mobile drawer.
- Preserved menu search, nested branches, one expanded top-level group, breadcrumbs, localization, and active state on leaf destinations only.
- Added a stable navigation slot so progressive fragment responses can refresh menu content without replacing the long-lived application shell.

Released as part of the coordinated KetJS 0.1.14 package set.

## 0.1.13 — application navigation

- Added the responsive `AppNavigation` shell for dense desktop sidebars and mobile drawers.
- Added nested navigation branches with a single expanded top-level group and active state on leaf items.
- Kept application breadcrumbs visible while navigation context changes.
- Added a complete application demo and browser coverage for desktop, mobile, theme switching, and nested standalone navigation.

Released as part of the coordinated KetJS 0.1.13 package set.

## 0.1.12 — reproducible inventory release

- Excluded ignored local build products from generated inventory inputs while preserving non-ignored new source files.
- Kept source-archive generation deterministic when Git metadata is unavailable.

This patch has no public component API changes and supersedes the unpublished npm attempts for 0.1.10 and 0.1.11.

## 0.1.11 — component system Waves 0–6

- Standardized the public primary scale around Indigo `#5968DF`.
- Aligned accent, focus, navigation, and informational semantic roles with the new scale in both light and dark themes.
- Updated the component catalogue specimen and added regression coverage for every public primary swatch.

- Added a deterministic public/compatibility inventory and governance checks.
- Organized component source, CSS ownership, registry metadata, specimens, and token contracts.
- Added interaction primitives and a shared progressive-enhancement runtime.
- Added typed forms, controlled pickers, data operations, and record/workspace composition.
- Added migration and release-readiness audits; deprecated compatibility page recipes remain available.
- Added a generic KetAtlas adapter descriptor, deterministic materializer and verification lock.

Released as part of the coordinated KetJS 0.1.11 package set.
