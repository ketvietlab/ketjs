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
] as const

export type NoticeTone = 'info' | 'positive' | 'warning' | 'danger'

// Lucide (ISC) glyphs, vendored per tone: info, circle-check, triangle-alert, circle-alert.
const NOTICE_ICONS: Record<NoticeTone, () => TemplateResult> = {
  info: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  positive: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  warning: () => (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  danger: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
}

export const Notice = (props: {
  title: string
  message: string
  tone?: NoticeTone
  actions?: JSXChild
}): TemplateResult => (
  <aside
    data-ui="notice"
    data-pattern="notice"
    data-tone={props.tone ?? 'info'}
    role={props.tone === 'danger' ? 'alert' : 'status'}
  >
    <span data-ui="notice-mark" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {NOTICE_ICONS[props.tone ?? 'info']()}
      </svg>
    </span>
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
