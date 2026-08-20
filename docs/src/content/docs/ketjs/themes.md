---
title: Themes and KTL
description: Build installable KetJS themes with restricted KTL templates, tokens, regions, joints, sections, and islands.
---

KetJS has two presentation languages. First-party behavior uses `ketjs-view`, where trusted application
code may run. Installable themes use KTL, a restricted template language that reads data and invokes
named rendering contracts but cannot call JavaScript.

## Define a theme

```ts
import { defineTheme } from 'ketjs'
import { loadTemplates } from 'ketjs/theme'

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

Errors name the template and line. An empty or missing directory fails early.

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

Use `makeDrop()` or `makeDrops()` to build immutable null-prototype objects containing only those
fields. `sealScope()` recursively refuses functions. KTL also rejects `constructor`, `prototype`, and
`__proto__` paths and throws if a readable property resolves to a function.

## Tokens and CSS layers

`tokensToCss()` converts declared tokens to `--ket-*` custom properties and emits the cascade order:

```text
ket.reset → ket.theme → ket.app → ket.user
```

Application styles load after theme styles in dependency order. `scopedCss(section, css)` scopes a
block to a section boundary. Keep semantic tokens stable and map component CSS to tokens instead of
hard-coding a second palette.

## Theme verification

Before distributing a theme:

1. Compose it with every required module.
2. Render every provided region with representative view models.
3. Test missing optional data, long translations, and the `qps` pseudo-locale.
4. Verify every joint, region, section, and island name.
5. Confirm KTL receives data only and all raw output has a documented trusted producer.
6. Enable and disable optional modules to verify graceful runtime restriction.
