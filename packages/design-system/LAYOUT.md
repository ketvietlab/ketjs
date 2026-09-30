# Layout rules

These rules decide where a frame, a heading and a gap go. They are enforced by the
components and by the layout audit, not by memory. When a screen looks wrong, fix
the component here. Do not patch the screen.

They follow the layering models of the large systems: Carbon's layer sets and
contextual tokens, Atlassian's elevation levels, Material's "don't force content
into cards", Polaris's rule that padding shrinks as nesting deepens, and Fluent's
two-layer app model.

## L1. Three levels, and the component knows which one it is on

| Level | What it is | Fill |
| --- | --- | --- |
| canvas | The page behind the work: list, dashboard, settings | page grey (grouped) |
| surface | A working region placed on the canvas | white, one border |
| overlay | A modal sheet, dialog or popover | white, shadow |

`Surface`, `ModalSheet`, `ConfirmDialog`, `Popover`, `ContentCard`, `KanbanCard`
and, in the grouped presentation, the record context rail make a white region.
Everything rendered inside one is on that level. Applications never pass a prop to
say which level they are on.

## L2. One boundary between the content and the canvas

- A frame is drawn only when content rises from the canvas to a surface.
- Inside a white region, `Surface`, a titled or untitled `DataTable`, `Disclosure`
  and `Metric` render flat. They keep their heading and spacing and lose their
  border, fill, radius and shadow. A nested surface's title steps down to the
  section size.
- Objects keep their boundary everywhere: `ContentCard` and `KanbanCard` are each one
  thing that opens, moves or is selected.
- A nested `Surface tone="subtle"` stays a tinted well, for reference material such as
  a log or a quotation. It has no border.
- A control's border (input, select, checkbox, button) belongs to the control and is
  not a frame.

Do: put `DataTable title="Products"` straight into a modal body. It renders as a
section of the modal.
Don't: wrap a modal's form groups in `Surface`, or draw a card in app CSS.

## L3. Separate groups with the lightest tool that works

1. Space.
2. A section heading.
3. A hairline divider between peer sections: long forms (two or more groups), table
   rows, cells of a metadata strip.
4. A tinted well (`Surface tone="subtle"`), only for reference material.

A frame is never a way to separate groups.

## L4. Three containers, chosen by what the thing is

| Container | When | Anatomy |
| --- | --- | --- |
| `Surface` | A working region on the canvas | pinned head (title, description, actions) and body |
| `Section` | A group inside a surface or overlay | title, description, actions, body; no frame |
| `ContentCard`, `KanbanCard`, `Metric` | One independent object | its own boundary and actions |

## L5. Headings are pinned by level; the application passes words

- Page title: `--kv-page-title-size`: 24px from 48rem up, 17px below that, including compact operational lists. Density does not change title size. Surface title: `--kv-text-xl`. Section title and nested
  surface title: `--kv-text-lg`. Modal title: `--kv-text-xl`.
- The position of title, description and actions, and the gap under them, belong
  to the component. An application does not resize a heading or move its actions.

## L6. Spacing by level: deeper is tighter

| Role | Token | Default | Grouped |
| --- | --- | --- | --- |
| Page gutter | `--kv-page-padding-x` | 28px | 12px |
| Surface inset (head and body) | `--kv-surface-inset` | 20px | 12px |
| Gap under a surface heading | `--kv-surface-head-gap` | 20px | 12px |
| Between sections | `--kv-gap-section` | 28px | — |
| Between fields | `--kv-gap-form-row` | 14px | — |

A surface's heading and body share one inset, so its title, notices and tables
line up on one edge. `padding="none"` is for content that runs to the surface's
edge, such as a standalone table. A titled table keeps the 12px inset.

## L7. Pattern rules

- **Modal.** The body is one white region. Inside it, use `Section` and the flat
  forms of `Surface` and `DataTable`. Tabs inside a modal follow the same rule.
- **Table.** On the canvas a table is its own surface. Inside a surface or overlay it
  has no frame, only row lines.
- **Form.** Fewer than six fields: one flat grid. Several groups: one `Section` per
  group, divided by hairlines. Secondary detail goes in a `Disclosure`, which renders
  unframed inside a white region.
- **Notice.** As wide as the content it sits in, aligned with the heading. No extra
  margin.
- **Metadata strip** (due date, SLA, owner). A flat `DescriptionList`, cells divided
  by hairlines. No box around it on a white region.

## L8. Ownership

- Application CSS does not set border, background, padding, margin, radius, shadow,
  gap or heading type on an element the design system renders (`data-ui` or
  `data-pattern`), and does not use `revert-layer` to undo the design system.
- An application passes content and chooses components. When a component renders
  wrongly, change the component in this package.

## Enforcement

`ket-design-system-layout-audit` (the `auditLayoutCss` function of
`@ketvietlab/design-system/contract`) checks a stylesheet for three violations:

| Rule | Catches |
| --- | --- |
| `owned-hook` | L8: frame, spacing or heading type on a `data-ui`/`data-pattern` subject |
| `hand-made-frame` | L2: a rule with a full visible border and a radius or fill |
| `revert-layer` | L8: undoing the design system's layer |

An application adopts the audit area by area. It lists the stylesheets that already
comply in a config file and runs the audit in CI:

```jsonc
// File: design-system-layout.json
{ "enforce": ["modules/customer_care/**/*.css"] }
```

```sh
# Run from: the application root
ket-design-system-layout-audit --config design-system-layout.json
```

Every entry must match at least one stylesheet, so a moved directory fails instead
of passing empty. When an area is refactored, add it to `enforce` in the same
change. Nothing is ever removed from the list to make a build pass.
