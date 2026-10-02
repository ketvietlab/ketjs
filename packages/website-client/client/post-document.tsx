import { LiveDescription } from './live-description.tsx'
import { descriptionText } from './rich-description.ts'
import { renderLayout, walkLayout } from './renderer.tsx'
import type { RenderOptions } from './renderer.tsx'
import type { DescriptionBlock } from './rich-description.ts'
import type { Entry, Placement } from './types.ts'

/** A post being edited may not have its first revision yet. */
type PostSource = Pick<Entry, 'id' | 'type' | 'title'> &
  Partial<Pick<Entry, 'bodyDoc' | 'bodyText'>> & { revisionId?: string | null; layout?: Placement[] | null }

export function postDocument(entry: Pick<PostSource, 'bodyDoc' | 'layout'>): string {
  if (entry.bodyDoc) return entry.bodyDoc
  const blocks: DescriptionBlock[] = []
  walkLayout(entry.layout ?? [], (node) => {
    if (node.type !== 'website.rich_text') return
    if (node.settings!.heading) blocks.push({ type: 'h2', delta: [{ insert: node.settings!.heading }] })
    for (const text of String(node.settings!.body ?? '')
      .split(/\n{2,}/)
      .filter(Boolean))
      blocks.push({ type: 'p', delta: [{ insert: text }] })
  })
  return JSON.stringify(blocks.length ? blocks : [{ type: 'p', delta: [{ insert: '' }] }])
}
// Keep legacy non-prose sections visible. Saving prose never discards an old layout.
export function postLegacyLayout(layout: readonly Placement[] | null | undefined): Placement[] {
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
export function renderEntryBody(entry: PostSource, options: RenderOptions = {}, label = '') {
  if (entry.type !== 'post' || !entry.bodyDoc) return renderLayout(entry.layout ?? [], options)
  return (
    <>
      <LiveDescription
        id={`post-public-${entry.id}`}
        revision={entry.revisionId}
        value={entry.bodyDoc}
        text={entry.bodyText ?? ''}
        label={label || entry.title}
        readOnly
      />
      {renderLayout(postLegacyLayout(entry.layout), options)}
    </>
  )
}
export { descriptionText }
