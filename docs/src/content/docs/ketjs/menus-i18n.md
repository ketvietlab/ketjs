---
title: Menus and localization
description: Compose permission-aware navigation and module-owned translated message catalogues.
---

Menus and messages are module declarations. Composition checks navigation ownership and merges
language catalogues, while the runtime filters a menu by composed modules and the current viewer's
function grants.

## Declare navigation

```ts
// File: src/modules/sales/index.ts
export const sales = defineModule({
  name: 'sales',
  menus: {
    sales: {
      label: 'menu.app',
      path: '/admin/sales',
      sequence: 30,
      icon: 'cart',
    },
    'sales.orders': {
      parent: 'sales',
      label: 'menu.orders',
      path: '/admin/sales/orders',
      needs: 'sales.listOrders',
      sequence: 10,
      icon: 'list',
    },
    'sales.reports': {
      parent: 'sales',
      label: 'menu.reports',
      sequence: 20,
    },
    'sales.reports.monthly': {
      parent: 'sales.reports',
      label: 'menu.monthly',
      path: '/admin/sales/reports/monthly',
      needs: 'sales.monthlyReport',
    },
  },
})
```

A root entry is a top-level section. An entry without `path` is a heading. `parent` references a global menu ID,
and a module parenting onto another module's entry must declare that dependency.

Unknown parents, duplicate IDs, dependency violations, and invalid depths are composition errors.

## Permission-aware trees

Build navigation for one viewer:

```ts
// File: src/modules/example/index.ts
import { activeMenuRoot, buildMenu } from '@ketvietlab/ketjs'

const tree = buildMenu(liveManifest, {
  allow: grantedFunctionKeys,
  translate: translator(liveManifest, locale),
  active: url.pathname,
  q: searchText,
})

const currentRoot = activeMenuRoot(tree)
```

The filters run in this order:

1. the deployment manifest contains composed module behavior;
2. `needs` removes entries whose function is absent or not granted;
3. empty headings disappear with their children;
4. optional search preserves the ancestor path to every matching leaf;
5. the deepest matching route marks itself and every ancestor active.

A menu therefore does not advertise an operation that the viewer will be denied after clicking.

`ServeContext.menu()` performs these steps against the current request and is preferred inside routes.

## Semantic icons

`icon` is a semantic name selected by the module. The UI/theme owns the actual drawing and fallback.
An unknown icon should lose its glyph, not its navigation entry. Keep icon names stable across themes
and do not store SVG markup in the manifest.

## Declare messages

Message keys are local in the module declaration and qualified during composition:

```ts
// File: src/modules/example/index.ts
messages: {
  en: {
    'app.title': 'Sales',
    'menu.app': 'Sales',
    'menu.orders': 'Orders',
    'order.count': {
      one: '{count} order',
      other: '{count} orders',
    },
  },
  vi: {
    'app.title': 'Bán hàng',
    'menu.app': 'Bán hàng',
    'menu.orders': 'Đơn bán',
    'order.count': '{count} đơn bán',
  },
}
```

The full key is `sales.menu.orders`. Two modules may both own `menu.orders` without collision.

Messages may be strings or plural-category maps using `Intl.PluralRules` categories. Placeholders use
`{name}` and retain their braces when the caller omits a value, making mistakes visible.

## Translate

```ts
// File: src/modules/example/index.ts
import { translator } from '@ketvietlab/ketjs'

const t = translator(manifest, 'en', {
  fallback: 'vi',
  onMissing: (key, locale) => metrics.translationFallback(key, locale),
})

t('sales.menu.orders')
t('sales.order.count', { count: 3 })
```

The translator exposes:

- `locale`, the requested locale;
- `has(key)`, whether that exact locale contains the key;
- `resolves(key)`, whether either the locale or fallback contains it.

An unresolved key renders as the key rather than becoming blank. Missing translations fall back and
may be observed without breaking the build.

`Intl.PluralRules` instances are shared by locale. A running deployment also reuses one translator
per shipped locale, so route and screen composition may call `ServeContext.translate(locale)` without
reconstructing the plural engine. The deployment freezes these cached translators so one request cannot
change an instance that a later request will reuse.

## Date and time formatting

Use the shared formatter when a server-rendered list formats dates repeatedly:

```ts
// File: src/modules/example/screens/orders.ts
import { dateTimeFormatter } from '@ketvietlab/ketjs'

const formatter = dateTimeFormatter(locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: company.timezone,
})

const labels = orders.map((order) => formatter.format(new Date(order.createdAt)))
```

Equivalent option objects resolve to the same immutable `Intl.DateTimeFormat` instance, regardless of
property order. The pseudo-locale uses English's Intl rules while translated copy still expands. Prefer
binding the formatter before a large loop; repeated `dateTimeFormatter()` calls are safe and cached but
still have to canonicalize the options.

## KTL translation

When the theme runtime has a translator, KTL exposes it as the `_` filter:

```liquid
{% comment %} File: src/themes/example/templates/example.ktl {% endcomment %}
<h1>{{ 'sales.app.title' | _ }}</h1>
<span>{{ 'sales.order.count' | _: count }}</span>
```

The filter is used instead of putting a function in template scope. KTL scope remains data-only.

## Find missing messages

```ts
// File: src/modules/example/index.ts
import { formatMissing, missingMessages } from '@ketvietlab/ketjs'

console.log(formatMissing(missingMessages(manifest, ['en', 'vi', 'fr'])))
```

The report compares each requested catalogue to the union of declared keys. Use it in CI or release
tooling as a report; incomplete optional locales should not make application composition fail.

## Pseudo-locale

Use `PSEUDO_LOCALE` (`qps`) to expand and bracket strings:

```ts
// File: src/modules/example/index.ts
const pseudo = translator(manifest, PSEUDO_LOCALE, { fallback: 'en' })
```

The expanded output exposes fixed-width controls, truncation, and layouts tuned only to short source
language text. Test both left-to-right expansion and your actual longest supported content.

## Locale resolution

Runtime defaults come from:

```bash
# Run from: /path/to/ketjs
KET_LOCALE=en
KET_FALLBACK_LOCALE=en
```

Applications may resolve request locale through their route/session design. `ServeContext.localeOf()`
returns the locale selected by the running app, and `ServeContext.translate(locale)` returns its
translator. The server memoizes locale resolution for repeated calls with the same request/query/header
and checks a valid `?lang=` before parsing `Accept-Language`.

Keep locale preference separate from tenant and company identity. A user may change language without
changing the database or legal entity in scope.
