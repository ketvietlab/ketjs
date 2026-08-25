import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button } from './actions.tsx'
import { emptyState } from './state.tsx'

export const HOOKS = [
  'attachments',
  'attachment-list',
  'attachment-item',
  'attachment-link',
  'attachment-meta',
  'attachment-upload',
  'attachment-input',
] as const

export type AttachmentItem = {
  id: string
  name: string
  href: string
  size?: number | null
  mimetype?: string | null
}

export const attachmentPanel = (o: {
  items: readonly AttachmentItem[]
  uploadAction?: string | null
  emptyTitle: string
  emptyHint: string
  chooseLabel: string
  uploadLabel: string
}): TemplateResult => (
  <section data-ui="attachments">
    {o.items.length ? (
      <ul data-ui="attachment-list">
        {each(
          o.items,
          (item) => item.id,
          (item) => (
            <li data-ui="attachment-item">
              <a data-ui="attachment-link" href={item.href} target="_blank" rel="noopener">
                {item.name}
              </a>
              <span data-ui="attachment-meta">
                {[item.mimetype, item.size == null ? null : `${item.size} B`].filter(Boolean).join(' · ')}
              </span>
            </li>
          ),
        )}
      </ul>
    ) : (
      emptyState(o.emptyTitle, o.emptyHint)
    )}
    {!!o.uploadAction && (
      <form data-ui="attachment-upload" method="post" action={o.uploadAction} enctype="multipart/form-data">
        <label>
          <span>{o.chooseLabel}</span>
          <input data-ui="attachment-input" type="file" name="file" autocomplete="off" required />
        </label>
        {button({ label: o.uploadLabel, type: 'submit', variant: 'secondary' })}
      </form>
    )}
  </section>
)
