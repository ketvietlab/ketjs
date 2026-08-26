import { each } from '@ketvietlab/ketjs-view'
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
  'skeleton',
  'skeleton-line',
] as const

export type NoticeTone = 'info' | 'positive' | 'warning' | 'danger'

export const Notice = (props: {
  title: string
  message: string
  tone?: NoticeTone
  actions?: JSXChild
}): TemplateResult => (
  <aside
    data-ui="notice"
    data-tone={props.tone ?? 'info'}
    role={props.tone === 'danger' ? 'alert' : 'status'}
  >
    <span data-ui="notice-mark" aria-hidden="true" />
    <div data-ui="notice-copy">
      <p data-ui="notice-title">{props.title}</p>
      <p data-ui="notice-message">{props.message}</p>
    </div>
    {props.actions !== undefined && <div data-ui="notice-actions">{props.actions}</div>}
  </aside>
)

export const EmptyState = (props: { title: string; message: string; actions?: JSXChild }): TemplateResult => (
  <div data-ui="empty" role="status">
    <span data-ui="empty-mark" aria-hidden="true">
      ◇
    </span>
    <p data-ui="empty-title">{props.title}</p>
    <p data-ui="empty-message">{props.message}</p>
    {props.actions !== undefined && <div data-ui="empty-actions">{props.actions}</div>}
  </div>
)

export const LoadingState = (props: { label: string; lines?: number }): TemplateResult => (
  <div data-ui="loading" role="status" aria-live="polite">
    <span data-ui="loading-label">{props.label}</span>
    <div data-ui="skeleton" aria-hidden="true">
      {each(
        Array.from({ length: Math.max(1, props.lines ?? 3) }),
        (_, index) => index,
        (_, index) => (
          <span data-ui="skeleton-line" data-line={String(index + 1)} />
        ),
      )}
    </div>
  </div>
)
