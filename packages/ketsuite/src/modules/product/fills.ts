/**
 * What product adds to somebody else's screen.
 *
 * KTL — the same language a storefront theme is written in, and for the same
 * reason: this is code that *extends*, not code that runs. It cannot reach a
 * database, cannot call a function, and the compiler escapes every value. So it
 * stays text in the manifest, which is what lets `ket manifest` print it and
 * `ket diff` compare it across releases.
 *
 * It addresses a joint by name and knows nothing about where on the card it lands.
 * backend may move that markup freely; the joint is the contract, not the shape
 * around it. That is the difference from an XPath into somebody else's template.
 */
export const fills: Record<string, string> = {
  'backend:app-card.actions': `{% if app.name == 'product' %}<a data-ui="app-action" href="/admin/products">{{ 'product.app.openCatalogue' | _ }}</a>{% endif %}`,
}
