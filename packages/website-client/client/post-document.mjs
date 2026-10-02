import { html } from '@ketvietlab/ketjs-view'
import { LiveDescription } from './live-description.mjs'
import { descriptionText } from './rich-description.mjs'
import { renderLayout, walkLayout } from './renderer.mjs'

export function postDocument(entry) {
  if (entry.bodyDoc) return entry.bodyDoc
  const blocks = []
  walkLayout(entry.layout ?? [], (node) => {
    if (node.type !== 'website.rich_text') return
    if (node.settings.heading) blocks.push({ type: 'h2', delta: [{ insert: node.settings.heading }] })
    for (const text of String(node.settings.body ?? '')
      .split(/\n{2,}/)
      .filter(Boolean))
      blocks.push({ type: 'p', delta: [{ insert: text }] })
  })
  return JSON.stringify(blocks.length ? blocks : [{ type: 'p', delta: [{ insert: '' }] }])
}
// Keep legacy non-prose sections visible. Saving prose never discards an old layout.
export function postLegacyLayout(layout) {
  return (layout ?? [])
    .filter((node) => node.type !== 'website.rich_text')
    .map((node) => ({
      ...node,
      ...(node.slots
        ? {
            slots: Object.fromEntries(
              Object.entries(node.slots).map(([slot, children]) => [slot, postLegacyLayout(children)]),
            ),
          }
        : {}),
    }))
}
export function renderEntryBody(entry, options = {}, label = '') {
  if (entry.type !== 'post' || !entry.bodyDoc) return renderLayout(entry.layout ?? [], options)
  return html`${LiveDescription({ id: `post-public-${entry.id}`, revision: entry.revisionId, value: entry.bodyDoc, text: entry.bodyText ?? '', label: label || entry.title, readOnly: true })}${renderLayout(postLegacyLayout(entry.layout), options)}`
}
export { descriptionText }
