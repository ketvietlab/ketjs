import { defineTheme } from 'ketjs'

// A theme may only declare templates, fills, tokens and regions. Try adding
// `models` or `functions` here and defineTheme() refuses it.
export default defineTheme({
  name: 'theme_default',
  version: '1.0.0',
  depends: ['catalog'],

  templates: {
    layout: `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>{{ site.title }}</title></head>
<body class="ket" data-ket-section="layout">
  <header><a href="/">{{ site.title }}</a></header>
  <main>{% region "product.detail" %}</main>
  <footer>{{ site.tagline | default: "Chạy trên Ket" }}</footer>
</body></html>`,

    'product.detail': `<article data-ket-section="product" data-id="{{ product.id }}">
  <h1>{{ product.title }}</h1>
  <p class="price">{{ product.priceCents | money }}</p>
  {% if related %}
  <ul class="related">
    {% for r in related %}<li>{{ loop.index }}. {{ r.title | truncate: 20 }}</li>{% endfor %}
  </ul>
  {% endif %}
  {% joint "catalog:product.detail.footer" %}
</article>`,
  },

  tokens: {
    'color-accent': 'oklch(0.58 0.19 268)',
    'radius': '0.75rem',
  },
})
