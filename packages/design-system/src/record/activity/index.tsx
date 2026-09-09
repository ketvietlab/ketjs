import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState, LoadingState, Notice } from '../../primitives/feedback/index.tsx'
import { Person } from '../display/index.tsx'

export const HOOKS = [
  'activity-timeline',
  'activity-item',
  'activity-marker',
  'audit-log',
  'audit-item',
] as const

export type ActivityItem = {
  id: string
  actor: string
  actorDetail?: string
  action: JSXChild
  datetime: string
  timeLabel: string
  detail?: JSXChild
  redacted?: boolean
}

type FeedProps = {
  label: string
  items: readonly ActivityItem[]
  loading?: boolean
  loadingLabel?: string
  emptyTitle?: string
  emptyMessage?: string
  error?: string | null
  redactedLabel?: string
}

const state = (props: FeedProps): TemplateResult | null => {
  if (props.loading) return <LoadingState label={props.loadingLabel ?? 'Loading activity'} />
  if (props.error) return <Notice title="Activity unavailable" message={props.error} tone="danger" />
  if (!props.items.length)
    return (
      <EmptyState
        title={props.emptyTitle ?? 'No activity'}
        message={props.emptyMessage ?? 'Nothing has happened yet.'}
      />
    )
  return null
}

export const ActivityTimeline = (props: FeedProps): TemplateResult => {
  const placeholder = state(props)
  if (placeholder) return placeholder
  return (
    <ol data-ui="activity-timeline" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item) => (
          <li data-ui="activity-item">
            <span data-ui="activity-marker" aria-hidden="true" />
            <div>
              <Person name={item.actor} detail={item.actorDetail} size="small" />
              <p>{item.redacted ? (props.redactedLabel ?? 'Details redacted') : item.action}</p>
              {item.detail !== undefined && !item.redacted && <div>{item.detail}</div>}
              <time datetime={item.datetime}>{item.timeLabel}</time>
            </div>
          </li>
        ),
      )}
    </ol>
  )
}

export const AuditLog = (props: FeedProps): TemplateResult => {
  const placeholder = state(props)
  if (placeholder) return placeholder
  return (
    <ol data-ui="audit-log" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item) => (
          <li data-ui="audit-item">
            <time datetime={item.datetime}>{item.timeLabel}</time>
            <strong>{item.actor}</strong>
            <span>{item.redacted ? (props.redactedLabel ?? 'Change redacted') : item.action}</span>
          </li>
        ),
      )}
    </ol>
  )
}
