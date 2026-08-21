---
title: Themes and KTL
description: Build installable KetJS themes with restricted KTL templates, tokens, regions, joints, sections, and islands.
---

KetJS has two presentation languages. First-party behavior uses `@ketvietlab/ketjs-view`, where trusted application
code may run. Installable themes use KTL, a restricted template language that reads data and invokes
named rendering contracts but cannot call JavaScript.

## Define a theme

```ts
import { defineTheme } from '@ketvietlab/ketjs'
import { loadTemplates } from '@ketvietlab/ketjs/theme'

export const paper = defineTheme({
  name: 'theme_paper',
  version: '1.0.0',
  depends: ['website'],
  title: 'Paper',
  templates: loadTemplates(new URL('./templates/', import.meta.url)),
  tokens: {
    'color-background': '#ffffff',
    'color-foreground': '#172033',
    'radius-control': '4px',
  },
  assets: new URL('./assets/', import.meta.url),
  styles: ['paper.css'],
})
```

Themes are installable modules and appear in the application list. `defineTheme()` rejects models,
model extensions, functions, jobs, routes, and islands. A theme may place an island provided by a
normal module but never define one.

## Template files

`loadTemplates()` loads direct `.ktl` files from one directory. The filename without `.ktl` becomes
the template name:

```text
templates/
├── layout.ktl              → layout
├── website.page.ktl        → website.page
├── website.hero.ktl        → website.hero
└── menu.primary.ktl        → menu.primary
```

Errors name the template and line. An empty or missing directory fails early. Two modules providing
one template name is `E_TEMPLATE_DUPLICATE` rather than a silent last-one-wins; a theme providing a
name a module already uses is the override a theme exists for and remains allowed.

Inline `templates` objects remain supported, but files provide clearer ownership, editor tooling, and
location-aware diagnostics.

## Output and expressions

```liquid
<h1>{{ page.title }}</h1>
<p>{{ page.summary | default: "No summary" }}</p>
<strong>{{ amount | money: locale }}</strong>
```

Output is escaped by default. KTL supports property reads, literals, comparisons, boolean `not`, and
filters. It does not support function calls, imports, assignment, global access, or prototype access.

Built-in filters include:

- `upper`, `lower`;
- `money`, `number`;
- `default`, `length`, `truncate`;
- `json`;
- `_` when a translator is bound.

`{{ raw value }}` bypasses escaping and must only receive markup already produced by a trusted
boundary. Ordinary module data should never require it.

## Conditions and loops

```liquid
{% if order.overdue %}
  <span class="status danger">Overdue</span>
{% else %}
  <span class="status">Current</span>
{% endif %}

<ul>
  {% for line in lines %}
    <li>{{ loop.index }}. {{ line.name }}</li>
  {% endfor %}
</ul>
```

Inside a loop, `loop.index` is zero-based; `loop.first`, `loop.last`, and `loop.length` are also
available. A non-array loop source renders nothing.

## Render another template

Pass an explicit scope to a partial:

```liquid
<ul>
  {% for item in items %}
    {% render 'menu.item', item: item, compact: true %}
  {% endfor %}
</ul>
```

The callee receives only the named arguments, not the caller's complete scope. Missing templates and
recursive render chains fail with location-aware diagnostics and a depth limit.

## Regions

A region renders another named template with the current scope:

```liquid
<!doctype html>
<html>
  <body>
    <main>{% region "website.page" %}</main>
  </body>
</html>
```

Applications declare required regions and themes provide templates. A missing required region is a
composition error rather than a blank page at runtime.

## Joints and fills

Modules publish joints; dependent modules contribute KTL fills; themes choose where the joint appears:

```liquid
<article>
  <h1>{{ product.name }}</h1>
  {% joint "product:template.detail.footer" %}
</article>
```

Fills run in dependency order. A fill may render another published joint but cycles and excessive
depth fail. A disabled filler disappears; an installed omission removes the joint completely.

The owner declares joint props. The theme receives only contract fields rather than an unsealed
application object.

## Sections

A section is page data with a declared settings schema:

```ts
sections: {
  'website.hero': {
    title: 'Hero',
    settings: {
      heading: 'text',
      subheading: 'text?',
      ctaHref: 'text?',
    },
  },
}
```

A page template renders its ordered placements:

```liquid
<article data-path="{{ page.path }}">
  {% sections %}
</article>
```

The theme provides a template named after each section type, such as `website.hero.ktl`. A section
from a disabled module is skipped but remains in page data for later reinstall. A section unknown to
the entire deployment leaves an HTML diagnostic comment.

`validateLayout()` checks a layout against this schema on the way in, and the renderer projects each
placement to the declared settings on the way out: a stored layout that predates a schema change
reaches the template carrying declared keys only, with missing values as `null`. A section template
also receives `page`, which is context rather than one of its settings.

## Islands

Place module-owned behavior by name:

```liquid
<nav>
  {% island "website.search" %}
</nav>
```

The module declares the island and prop contract; the theme only chooses placement. Unknown islands
are composition errors against the full deployment. At runtime, an island from a disabled module
renders empty.

Built-in themes may mark one stable page boundary with `data-ket-slot` and expose the matching region
through `serve.pages.region`. Internal GET navigation then replaces only that region. Keep global
islands such as menu search outside it when their state should survive page changes. A third-party
theme that declares no slot continues to receive complete documents; fragment navigation is not an
implicit theme contract.

## Safe view models

Modules expose theme-visible fields through `views`:

```ts
views: {
  productCard: {
    of: 'product.Template',
    fields: ['id', 'name', 'listPrice'],
  },
}
```

A declared view is enforced, not merely named. When a joint or island prop declares a view key, the
value is projected before it crosses: the extension receives an immutable null-prototype object
carrying the declared fields and nothing else, with absent fields as `null`. Passing a whole row is
therefore safe — the extra columns do not travel.

```ts
joints: {
  'product.detail.footer': { props: { product: 'product.productCard' } },
}
```

The reader matters. A fill sees the fields declared by the view's owner, plus the fields its own
module declared in a view over the same model. A module that adds a field with `extend` and then
publishes a view over it has declared that field theme-visible and may read it back through the
owner's joint; a field no installed module declared anywhere never crosses.

`makeDrop()` and `makeDrops()` build the same projection by hand, for scopes an application composes
itself. `sealScope()` refuses functions anywhere inside a scope value, at any depth, and names the
path it found one at. KTL also rejects `constructor`, `prototype`, and `__proto__` paths and throws
if a readable property resolves to a function.

## Tokens and CSS layers

Declared `tokens` become CSS without a theme doing anything: the framework serves them at
`/_ket/tokens.css` and links that stylesheet into every document a theme renders. The tokens served
are those of the modules that actually render the page — installed modules plus the selected theme —
so a deployment shipping several themes gets the palette of the one the site chose rather than the
one that composed last.

`tokensToCss()` performs the conversion to `--ket-*` custom properties and emits the cascade order:

```text
ket.reset → ket.theme → ket.app → ket.user
```

Tokens land in `ket.theme`; application styles load after them in dependency order.
`scopedCss(section, css)` scopes a block to a section boundary. Keep semantic tokens stable and map
component CSS to tokens instead of hard-coding a second palette. `ThemeRuntime.tokensCss` carries the
same stylesheet for a caller rendering outside the HTTP server.

## Theme verification

Before distributing a theme:

1. Compose it with every required module.
2. Render every provided region with representative view models.
3. Test missing optional data, long translations, and the `qps` pseudo-locale.
4. Verify every joint, region, section, and island name.
5. Confirm KTL receives data only and all raw output has a documented trusted producer.
6. Enable and disable optional modules to verify graceful runtime restriction.
