/** Record-route assertions inspect the page, excluding the shell's inert search dialog.
 * Search dialog opening, closing and focus are covered by global-search-launcher.test.ts.
 * Keep every record modal (including an accidentally open SSR modal) in the assertion input.
 */
export const withoutGlobalSearchDialog = (html: string): string =>
  html.replace(
    /<dialog data-ui="global-search-dialog"([^>]*)>[\s\S]*?<\/dialog>/gu,
    (markup, attributes: string) => (/\sopen(?:\s|=|$)/u.test(attributes) ? markup : ''),
  )
