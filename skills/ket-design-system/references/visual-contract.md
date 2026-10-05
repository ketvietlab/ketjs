# Visual contract

## Reference and identity

Dimensions are pinned to Shopify Polaris React **13.9.5**, polaris-tokens **9.4.2**,
standard theme. Do not mix the optional light-mobile theme into these responsive rules.
Sources: [Polaris](https://www.npmjs.com/package/@shopify/polaris/v/13.9.5) and
[tokens](https://www.npmjs.com/package/@shopify/polaris-tokens/v/9.4.2).
Két retains its semantic colours, Inter font family, 400/500/600/700 weight roles,
Lucide geometry, native navigation and ERP composition. Desktop density and side
labels are Két policy, not a claim of complete Shopify parity.

## Typography

Values are font-size / line-height / weight, in CSS px at a 16px root. Implement
through rem-based tokens so user text scaling remains possible.

| Role | Desktop >=768px | Mobile <768px | Owner |
| --- | --- | --- | --- |
| Page/modal title | 20/24/600 | 20/24/600 | Page/modal header |
| Working surface title | 14/20/600 | 14/20/600 | Surface |
| Section/nested surface title | 13/20/600 | 13/20/600 | Section or flattened Surface |
| Body/table value | 13/20/400 | 13/20/400 | Content component |
| Field/column label | 13/20/500 | 13/20/500 | Field/table |
| Help/metadata | 12/16/400 | 12/16/400 | Field or content component |
| Editable value | 13/20/400 | 16/24/400 | Input/select/textarea |
| Default button label | 13/20/500 | 13/20/500 | Button |
| Compact button label | 12/16/500 | 12/16/500 | Button |

Polaris low-level Text sizes remain: bodyXs=11/12, bodySm=12/16, bodyMd=13/20,
bodyLg=14/20; headingXs=12/16, headingSm=13/20, headingMd=14/20, headingLg=20/24.
Large headings are 24/32, 30/40, 36/48 desktop and 20/24, 24/32, 30/40 mobile.
Use these large roles only in an explicit metric/editorial pattern, not operational
page headers. Status badges, identifiers and emphasized errors retain their own
documented component roles; do not infer a new type scale from an old hard-coded weight.

Page, Surface, Section and Field receive content; consumers do not restyle their
headings/labels. Do not add a description under an operational page title merely to
fill space. Put explanatory copy in its relevant region or empty state. Legacy
description props can remain for compatibility; their existence is not a new pattern.
Tone does not change size. Numeric values use tabular digits and appropriate alignment.
Normal body text stays 13px on mobile; editable text grows to 16px. Density and theme
never resize headings. Long text must wrap or use an explicit accessible truncation
contract; never shrink text to fit. Zero default outer text margins.

## Spacing and controls

| Relationship | Size | Owner |
| --- | --- | --- |
| Related actions | 8px | ActionGroup |
| Title block to content | 8px | Surface/Section |
| Surface/card inset | 16px desktop, 12px mobile | Surface/object card |
| Modal inset | 16px | Overlay |
| Form columns | 24px | Form layout |
| Form rows | 16px | Form layout |
| Field groups | 16px | Form layout |
| Card/working-section gap | 12px desktop / 8px mobile, `--kv-layout-gap` | Parent layout |
| Page gutter | 12px desktop / 8px mobile, `--kv-layout-gap` | Page; keep header and body aligned, with no additional shell inset |
| Default/prominent button and input height | 32px desktop, 36px mobile | Control |
| Explicit compact button height | 28px desktop, 32px mobile | Button |
| Button/input block / inline padding | 6 / 12px | Control |
| Button/input radius | 8px | Control |

Default/prominent Button maps to Polaris **large** to align with TextField. Compact
maps to medium and is not used to build a normal input/action row. Icon-with-text
uses the Button-owned 20px box and 2px inner gap; do not substitute the 8px group gap.
Textarea grows by rows/content. Native and compound controls use the same type and
geometry. Loading keeps the button's label/icon footprint and accessible name.

24px is the gap between form columns; the page gutter uses `--kv-layout-gap`: 12px on desktop and 8px below
768px, including below a record body. The form-column
gap is Két policy (Polaris FormLayout.Group uses 12px); it separates complete fields,
not a label from its input. Form rows remain 16px; working-section gaps use `--kv-layout-gap`. Stack gap aliases
are none=0, tight=4, compact=8, column=12, default/loose=12 desktop and 8 mobile. The last two are
compatibility aliases, not distinct density levels. Use pattern defaults before
choosing generic gaps. Parent presentation/theme CSS must not override a child's gap.

Labels sit beside controls at >=768px, and above controls below 768px or when their
field container is narrower than 28rem. The component measures its container;
modules do not position labels. Help/errors align with the control column. Single
checkbox labels stay beside their box. Align input/action rows by control boxes,
not by wrappers whose label/help content differs.

Desktop table rows have a 40px dense baseline in all density presets; wrapped content
may increase height. Mobile row baselines are 44/52/60px for compact/default/comfortable.
Do not clip long content to enforce a fixed row height. Theme changes colour only.
KetTable columns opt into descriptive wrapping with `wrap: true`; the table owns
the preferred maximum text width and row growth. In a scrolling table, descriptive
columns retain a readable minimum (12rem, or 18rem for `width: 'wide'`); mobile scrolls
the table locally instead of squeezing words into one-character columns. Stacked
tables release that minimum. Keep identifiers and numeric columns concise.
The list result footer is metadata on the canvas, not another framed surface.

## Application navigation

AppNavigation owns menu geometry, including NavigationToggle and the mobile drawer.
These are Két navigation roles, not a requirement to give every component one size.
Navigation groups default to exclusive accordions. Set `NavigationGroupData.exclusive`
to `false` for independently collapsible branches, and set each branch's `expanded`
to `true` to open all of them initially. This also applies to nested branches and
the mobile drawer; opening the drawer remains a separate action.

| Role | Desktop >=768px | Mobile <768px |
| --- | --- | --- |
| Root label | 14/20/500, primary text colour | Same |
| Child label | 13/20/400, secondary text colour | Same |
| Selected leaf | Its level's size, weight 500, primary text colour | Same |
| Single-line row minimum: root / child | 30 / 28px | 44 / 44px |
| Leading icon box | 20px | 20px |
| Gap between present icon / copy / count | 10px | 10px |
| Row gap | 2px | 2px |
| Row padding: root / child | 4px 8px / 2px 8px | Same |
| Menu opener and close button hit area | Hidden | 44 x 44px |

The sidebar is 228px wide; the mobile drawer is at most 320px and 86vw. First-level
child rows start 30px after the parent row, aligning plain child text with a parent
label that has a leading icon. Each deeper level advances 20px. A guide line is included in the indent, never added on top. Labels and
optional descriptions wrap and rows grow without truncation or font shrinking.
Optional leading content/counts consume width only when present; copy gets the
remaining width and counts do not shrink. Icon geometry uses the sidebar icon token,
never a typography token. Density does not resize menu rows, icons or labels.

CSS and drawer interaction runtime use the same <768px boundary. Opening, closing,
keyboard focus and native links remain component-owned. Verify long translations,
labels with/without icons and counts, nested levels, and crossing 767/768px while
the drawer is open. Do not reduce all labels to one size merely to unify metrics.

## Surface and border levels

| Level | Component | Treatment |
| --- | --- | --- |
| Canvas | Page/list/workspace | Két canvas colour; no frame around the entire page |
| Working surface | Surface/titled table on canvas | Surface fill, one subtle token border/radius, no default shadow |
| Overlay | Modal/Dialog/Popover | One outer surface with its component's elevation and backdrop behavior |

Section groups content within a level; it creates no new level. A nested Surface,
DataTable, Disclosure or Metric becomes flat inside a working surface/overlay: no
extra frame, fill, shadow or accumulated inset; keep its title/content and section
spacing. Context determines flattening; modules do not pass invented level props.
Prefer Section for an intentional inner group. A subtle reference well may retain a
tint without border. Do not remove a table's row separators when flattening its frame.

ContentCard and KanbanCard represent independently openable/movable/selectable objects;
they keep their own boundaries even inside a surface. This exception does not apply
to groups of form fields. A table on canvas can own one boundary; inside a modal it
uses the modal's boundary. TabbedView/TabPanel add no second card or horizontal inset.

Separate groups with space, then heading, then a hairline between peers when useful.
Do not draw both a parent's closing border and a child's opening border for one edge.
Keep title and body on the same inset. Use the relevant semantic tokens for each:

- **Boundary:** region against canvas, owned by Surface/Overlay.
- **Divider:** peer rows/sections/cells, owned by the parent collection/layout.
- **Control:** affordance for input/action, owned by that control.
- **State:** focus/selected/invalid, owned by the interactive component.

Focus, selection and error must not shift geometry. Use component-owned rings or
reserved borders, Két state tokens and accessible state attributes. A control border
does not count as an extra working surface. A shadow expresses overlay elevation;
do not add shadows to make ordinary groups look more important.

## CSS ownership

Use public components and --kv-* semantic tokens. Product CSS must not set font-size,
line-height, font-weight, padding, margin, gap, border, fill, radius, shadow or inset
on DS hooks/private descendants, or override their tokens to restyle one route.
No revert-layer or unlayered override to bypass ownership. Runtime style values for
measured positions are allowed only in the owning component/runtime. Semantic rich
text, hidden form inputs and documented compatibility adapters are not imitation UI.

### Kanban drag targets

For a board lane, pass `KanbanGrid.dropTarget`, a localized `dropLabel` and
`emptyLabel`. The lane owns a minimum 12rem hit area even with zero cards and
keeps space after its last card droppable. This geometry belongs to the DS;
consumers must not implement lane height by inserting a fake card.
`KanbanCard.draggable` opts into native drag. The product runtime owns permitted
transitions, persistence and confirmation; it sets `data-drop-state` to `accept`
or `reject` for feedback and must keep a keyboard-accessible move command.
A drop must resolve the target lane, never require a target card.

ModalSheet dialog sizes: `small` (34rem) for short single-column forms,
`default` (56rem) for two-column forms or modest tables, and `large` (75rem)
for dense workspaces. Choose by content structure, not field count.

## Credential completion

Operational ERP fields retain `autocomplete="off"`. Public customer sign-in is a
scoped exception owned by the website authentication view: the login field uses
`username` and the password field uses `current-password` so password managers can
identify the credentials. This exception does not apply to ordinary website or ERP
forms. Keep the field associations and native password semantics.

### Image drop zones

`DropZone` owns one visible frame, its caption, hint, preview and focus/drag states.
Pass `preview={null}` for an empty square image target or `{ src, alt }` for an image.
The transparent native file input covers that frame and stays keyboard accessible;
do not render a separate image placeholder and native file chooser below it.
The application runtime owns file validation, transport and `dragging` state; it
must ignore uploads while disabled or saving. Keep any image viewer action separate
from the file input target. `FileUpload` remains the explicit native chooser variant.
