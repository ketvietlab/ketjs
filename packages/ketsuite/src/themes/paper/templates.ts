/**
 * A theme's whole vocabulary: layout, the page region, and one template per section
 * type it supports. There is no JavaScript here and there cannot be — a template
 * that wants behaviour places an island instead.
 */
export const templates: Record<string, string> = {
  layout: `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ page.title }}</title>
  {% joint "website:page.head" %}
</head>
<body class="ket">
  {% joint "website:page.body.start" %}
  <main class="page">{% region "website.page" %}</main>
  {% joint "website:page.body.end" %}
</body>
</html>`,

  // The page is its layout: whatever sections the data says, in that order.
  'website.page': `<article data-ket-section="page" data-path="{{ page.path }}">{% sections %}</article>`,

  'website.hero': `<section class="hero" data-ket-section="hero">
  {% if image %}<img class="hero-bg" src="{{ image }}" alt="">{% endif %}
  <h1>{{ heading }}</h1>
  {% if subheading %}<p class="sub">{{ subheading }}</p>{% endif %}
  {% if ctaLabel %}<a class="cta" href="{{ ctaHref | default: '#' }}">{{ ctaLabel }}</a>{% endif %}
</section>`,

  'website.rich_text': `<section class="prose" data-ket-section="rich-text" data-align="{{ align | default: 'left' }}">
  {% if heading %}<h2>{{ heading }}</h2>{% endif %}
  <div>{{ body }}</div>
</section>`,

  'menu.primary': `<nav class="primary" data-ket-section="menu">
  <ul>{% for item in menu %}<li><a href="{{ item.href }}">{{ item.label }}</a></li>{% endfor %}</ul>
  {% if showSearch %}{% island "website.search" %}{% endif %}
</nav>`,
}
