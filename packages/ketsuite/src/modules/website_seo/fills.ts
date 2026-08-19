/** Filled into a joint the website module published. No import, no patch, no fork. */
export const fills: Record<string, string> = {
  'website:page.head': `{% if meta.metaDescription %}<meta name="description" content="{{ meta.metaDescription }}">{% endif %}
{% if meta.canonical %}<link rel="canonical" href="{{ meta.canonical }}">{% endif %}
{% if meta.noindex %}<meta name="robots" content="noindex">{% endif %}
{% if meta.ogImage %}<meta property="og:image" content="{{ meta.ogImage }}">{% endif %}`,
}
