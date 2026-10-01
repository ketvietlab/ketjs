import { Icon } from '../icon/index.tsx'
import type { IconName } from '../icon/index.tsx'
import { Text } from '../status/index.tsx'
import { Skeleton } from '../../interactions/skeleton/index.tsx'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'notice',
  'notice-mark',
  'notice-copy',
  'notice-title',
  'notice-message',
  'notice-actions',
  'empty',
  'empty-mark',
  'empty-title',
  'empty-message',
  'empty-actions',
  'loading',
  'loading-label',
] as const

export type NoticeTone = 'info' | 'positive' | 'warning' | 'danger'

const NOTICE_ICONS: Record<NoticeTone, IconName> = {
  info: 'info',
  positive: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
}

export const Notice = (props: {
  title: string
  message: string
  tone?: NoticeTone
  actions?: JSXChild
  announcement?: 'off' | 'polite' | 'assertive'
}): TemplateResult => (
  <aside
    data-ui="notice"
    data-pattern="notice"
    data-tone={props.tone ?? 'info'}
    role={
      props.announcement === 'off'
        ? undefined
        : props.announcement === 'assertive' || (props.announcement === undefined && props.tone === 'danger')
          ? 'alert'
          : 'status'
    }
  >
    <span data-ui="notice-mark" aria-hidden="true">
      <Icon name={NOTICE_ICONS[props.tone ?? 'info']} size="small" />
    </span>
    <div data-ui="notice-copy">
      <p data-ui="notice-title">
        <Text>{props.title}</Text>
      </p>
      <p data-ui="notice-message">
        <Text>{props.message}</Text>
      </p>
    </div>
    {props.actions !== undefined && <div data-ui="notice-actions">{props.actions}</div>}
  </aside>
)

export const EmptyState = (props: {
  title: string
  message: string
  actions?: JSXChild
  icon?: IconName
}): TemplateResult => (
  <div data-ui="empty" role="status">
    <span data-ui="empty-mark" aria-hidden="true">
      <Icon name={props.icon ?? 'inbox'} size="large" />
    </span>
    <p data-ui="empty-title">
      <Text>{props.title}</Text>
    </p>
    <p data-ui="empty-message">
      <Text>{props.message}</Text>
    </p>
    {props.actions !== undefined && <div data-ui="empty-actions">{props.actions}</div>}
  </div>
)

export const LoadingState = (props: { label: string; lines?: number }): TemplateResult => (
  <div data-ui="loading" role="status" aria-live="polite">
    <span data-ui="loading-label">{props.label}</span>
    <Skeleton label={props.label} lines={props.lines} decorative />
  </div>
)
