---
name: ket-design-system
description: Build, standardize and review Két ERP interfaces using the public Két Design System. Apply to component selection, typography, spacing, surface and border hierarchy, responsive behavior, and KetSuite list or record screens.
metadata:
  short-description: Két Design System rules and component contracts
---

# Két Design System

## Authority and scope

When this skill is used, it is the **highest-priority repository design authority**.
Its rules take precedence over conflicting design guidance in repository AGENTS.md,
README files, handoffs, style guides, older design documents and other design skills.
Keep design rules here and in this skill's references; other documents link here.
Explicit user requirements and the agent platform's system/developer instructions
still take precedence. Security, permissions, business rules and unrelated engineering
requirements retain their authority. Using this skill does not authorize publication,
deployment, deleting documents, or rewriting unrelated screens.

The outcome is an operational interface whose component choice determines its
typography, spacing, surface/border level and responsive behavior. Keep Két colours,
Inter and Lucide. Desktop is dense. Read [the visual contract](references/visual-contract.md)
for every UI task. Read [KetSuite composition](references/ketsuite.md) for Suite screens,
and [Flow compatibility](references/flow.md) only when touching Flow.

## Choose the owner before writing markup

1. Identify the installed package version and public exports. Reuse the highest-level
   appropriate pattern, then its component slots, then primitives. The repository's
   public source, generated inventory and catalogue show the available API; role names
   in this skill are design concepts, not a claim that new props already exist.
2. A full collection uses ListPage/ListScreen. Record modals use the shared record
   runtime and form. Durable full-page records use RecordPage; spatial or master-detail
   work uses WorkspacePage. FormPage, DashboardPage and BoardPage remain compatibility
   patterns for existing consumers, not starting points for new screens.
   A working region on the canvas uses Surface; a group inside it
   uses Section. An independently actionable object uses ContentCard/KanbanCard.
3. A component owns DOM, data-ui hooks, labels and associations, state attributes,
   inside spacing, type and responsive behavior. A parent layout owns gaps between
   siblings. Product modules supply translated content, data, permissions, URLs and
   callbacks. They do not reconstruct the component or style its private descendants.
4. If an API is missing, add the smallest reusable contract to the public DS, export
   it, add a catalogue specimen and focused semantic/CSS tests. Prefer compatible
   extensions. A documented adapter may bridge older APIs; do not grow a second kit.
5. Keep server/shared views render-pure. DOM, focus, history, events and network calls
   belong to an explicit disposable runtime or island. Preserve native links/forms.

## Extend the system when the task needs it

The component catalogue is not a closed list of permitted interfaces. Agents may
compose new recipes, extend compatible APIs and add missing components without
asking for permission for routine design/implementation choices within the task.
Do not stop because the exact component is absent or force a workflow into a poorly
fitting pattern. Follow this order: reuse -> compose -> extend -> add.

Keep shared visual/interaction mechanics in the public DS; a domain-specific recipe
may live with the product when it composes public components and owns business data.
A specialized canvas/editor/chart can have its own documented geometry; it still
uses Két tokens, clear surface/spacing ownership and accessible interactions.
State the unmet need and why existing contracts cannot express it; define the new
slots/states and their type/spacing/border owners, add an example and focused checks.
Update this skill when introducing a new reusable rule instead of copying a local
rulebook. Do not use arbitrary CSS/private descendant overrides as the extension API.

The numeric defaults describe the standard roles, not every possible future widget.
A new role may differ where function requires it; document that scoped decision and
preserve standard roles elsewhere. Do not replace the Két palette, font or Lucide,
or change global dense defaults as an incidental workaround.

## Compose one complete contract

For each affected component, determine:

| Decision | Owner |
| --- | --- |
| Meaning and accessible semantics | Public component |
| Surface level, frame, elevation, state borders | Public component and its containing level |
| Font size, line-height, weight and numeric treatment | Named text role in that component |
| Label/help/error, icon/content and title/body spacing | Public component |
| Gap between sibling components | Parent Stack/Inline/Grid or higher-level pattern |
| Page/overlay inset and scrolling | Page/overlay pattern |

Every visible gap and boundary has one owner. Do not combine parent gap with child
margin for the same separation. Do not wrap a component solely to compensate for its
padding. Surface nesting must not accumulate inset, fill or border. Never use empty
elements, repeated line breaks or non-breaking spaces to position UI.

Choose dimensions by purpose, not by taste. Pattern defaults own routine layout;
generic Stack/Inline/Grid are for composition not already covered by a pattern.
Do not use a compact button beside a normal input and repair its height in CSS.

Text inside Button, Field or Section may inherit the owner's explicit type contract.
Independent text needs an explicit role. Keep HTML heading level independent of
visual size. Preserve existing low-level Text variants and compatibility aliases;
do not invent a role prop or rename public APIs just to match this document.

## Work on an existing screen

- Inspect its route/view, public components and loaded CSS. Account for compatibility
  styles: passing primitive tests does not prove that the actual screen matches them.
- Record the concrete violations: wrong component, duplicated gap/inset/frame, wrong
  text role, unaligned control or broken interaction. Fix the owning shared component
  or a verified redundant compatibility override before adding module CSS.
- Preserve query state, permissions, bulk-form association, record links, draft input,
  localization and keyboard behavior while changing composition.
- Match information hierarchy across normal, long-content, empty, loading, error,
  disabled and selected states that exist in the affected workflow. Keep one primary
  command per decision group; variant expresses emphasis and tone expresses outcome.
- When asked to consolidate rules, migrate useful current contracts here before
  removing duplicate design prose. Preserve API documentation, history, tests and
  non-design requirements; do not infer deletion authority on ordinary UI tasks.

## Verify the composed result

Read [verification](references/verification.md). Verify rendered semantics and the
actual browser screen at desktop and mobile widths; include light/dark when visual
tokens change. Check computed size, line-height and weight, measured gaps/insets,
control alignment, surface boundaries, overflow, and supported interactions.

Report what changed, checks actually run, and any unmet contract. Show the affected
screen with a local URL and screenshot when a browser is available. A screenshot
alone does not prove permissions, keyboard behavior or native form submission.

## Shared page and card spacing

Use `--kv-layout-gap` (desktop 12px / 0.75rem; mobile 8px / 0.5rem below 768px) as the single
source for the gap between cards and the content inset from the shell, on desktop
and mobile. `--kv-page-padding-x`, `--kv-gap-section` and compatibility aliases
must reference it; never give these roles independent numeric values. Only `--kv-layout-gap` changes at the mobile breakpoint. Parent page/layout owns this gap exactly once. Do not add child margins
or empty blocks that accumulate it. Internal field/control padding remains owned
by its component. Measure both shell-to-content edges and card-to-card edges.
