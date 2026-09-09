import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState, LoadingState, Notice } from '../../primitives/feedback/index.tsx'

export const HOOKS = ['attachments', 'attachment', 'media-gallery', 'media-item'] as const

export type AttachmentItem = {
  id: string
  name: string
  href?: string
  meta?: JSXChild
  redacted?: boolean
}

export const Attachments = (props: {
  label: string
  items: readonly AttachmentItem[]
  loading?: boolean
  error?: string | null
  redactedLabel?: string
}): TemplateResult => {
  if (props.loading) return <LoadingState label="Loading attachments" />
  if (props.error) return <Notice title="Attachments unavailable" message={props.error} tone="danger" />
  if (!props.items.length) return <EmptyState title="No attachments" message="No files have been attached." />
  return (
    <ul data-ui="attachments" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item) => (
          <li data-ui="attachment">
            {item.redacted || !item.href ? (
              <span>{props.redactedLabel ?? item.name}</span>
            ) : (
              <a href={item.href}>{item.name}</a>
            )}
            {item.meta !== undefined && <small>{item.meta}</small>}
          </li>
        ),
      )}
    </ul>
  )
}

export type MediaItem = {
  id: string
  src?: string
  alt: string
  caption?: JSXChild
  href?: string
  redacted?: boolean
}
export const MediaGallery = (props: {
  label: string
  items: readonly MediaItem[]
  emptyTitle?: string
  redactedLabel?: string
}): TemplateResult => {
  if (!props.items.length)
    return <EmptyState title={props.emptyTitle ?? 'No media'} message="No media is available." />
  return (
    <div data-ui="media-gallery" role="group" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item) => (
          <figure data-ui="media-item">
            {item.redacted || !item.src ? (
              <div role="img" aria-label={props.redactedLabel ?? 'Media redacted'}>
                Restricted
              </div>
            ) : item.href ? (
              <a href={item.href}>
                <img src={item.src} alt={item.alt} loading="lazy" />
              </a>
            ) : (
              <img src={item.src} alt={item.alt} loading="lazy" />
            )}
            {item.caption !== undefined && <figcaption>{item.caption}</figcaption>}
          </figure>
        ),
      )}
    </div>
  )
}
