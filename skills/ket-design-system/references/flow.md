# Flow compatibility

Flow UI is an existing compact work-management kit, scoped under data-flow-ui.
The following dimensions are a compatibility boundary, not an alternative ERP scale.
Keep its JavaScript/JSDoc and public dependency constraints in the package AGENTS.md.

- Render through `@ketvietlab/ketjs-view` and share primitives only through supported exports.

- Load `@ketvietlab/design-system/tokens.css`. Colors, typography, spacing, radius, shadow, focus and motion MUST use `--kv-*` tokens, directly or through `--flow-*` aliases. Do not create a Flow palette, font stack, type scale or alternate dark palette. Only explicitly documented density dimensions may differ.

- All component exports start with `Flow`. All owned hooks use `data-flow`, product aliases use `--flow-`, and all CSS selectors live under `[data-flow-ui]`. No global resets or automatic document-wide runtime.

- Components own their markup and styling. Consumers compose exports and pass state/callbacks; they do not recreate component DOM or override private descendants.

- Density is a Flow contract: 28px small control, 32px normal control, 36px compact row; touch contexts use at least 44px controls. Do not shrink Suite components using external CSS.

- Follow the Flow atlas reading hierarchy: main task text and navigation use `--kv-text-md` (14px), controls use `--kv-text-sm` (13px), metadata uses `--kv-text-xs` (12px). Compact spacing must not mean tiny text.

- Use `FlowShell`: 240px sidebar, 44px header, roughly 38px toolbar, responsive, centered work content with its own scroll area and a content-specific maximum width. Keep workspace titles in the header; do not add a large hero or project banner above work lists. Library/editorial pages may use a restrained introduction.

- Layout inset ownership: page-level FlowSection/FlowToolbar/FlowMetrics own the page gutter; pass `inset: "none"` when nesting them inside an already padded section or dialog. FlowSection supplies sibling gaps; do not stack page padding to separate groups.

- List spacing ownership: default `FlowListItem` uses `variant: "auto"`. A standalone item stays flush with its parent; a direct `FlowList` child receives list padding and separators from the list. Do not use inset rows as generic notices. Use `FlowSection.description` for subtitle/context attached to the heading, and put a collection's create action in that section's header.

- Content width has exactly two presets: `standard` 1200px and `wide` 1600px. Keep neighboring tabs in a navigation family on the same preset; do not introduce route-specific caps. User-requested exception: Board, Calendar, Timeline and document reading/editing surfaces use `full` (no maximum width). Board and scheduling views preserve normal page gutters; document shells span the work area while retaining their inner reading column. Dialog and inner reading-column dimensions are separate from the page container.

- When a component duplicates a design-system primitive, prefer moving the shared part into `packages/design-system` over growing a second copy here.

When touching a duplicated primitive, move or extend the shared contract in the
public design system instead of widening the copy. Preserve existing product
behavior and migrate one covered contract at a time. FlowClient composes Flow UI;
product consumers do not recreate these component internals or override their CSS.

## Existing form and toolbar roles

Form hierarchy: field labels use the existing 12px metadata token, muted text and medium weight; input/select/textarea values use the 14px body token, primary text and normal weight. Placeholder text is muted and inherits normal weight. The field wrapper never supplies bold type to editable values.

Filter/action toolbars separate content with spacing, without a full-width bottom rule. Page toolbars use 8px vertical padding; nested `inset:"none"` toolbars rely on their section/stack gap. Metrics and task-card metadata also avoid decorative horizontal rules. Keep selected navigation-tab underlines and structural boundaries for tables, modal headers, editor tools and distinct panels.
