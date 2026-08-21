// The two things a screen says when it has nothing to show.
//
// Both are components rather than markup in a screen, because "empty" and "broken"
// are the states most often written twice and styled once.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

/** The data-ui names this file emits. See ui/hooks.ts. */
export const HOOKS = [
  'notice',
  'notice-icon',
  'notice-copy',
  'notice-title',
  'notice-message',
  'notice-actions',
  'empty',
  'empty-icon',
  'empty-message',
  'empty-hint',
  'empty-actions',
  'error',
  'error-code',
  'error-message',
  'error-hint',
  'loading',
  'loading-label',
  'skeleton',
  'skeleton-line',
] as const

export type NoticeTone = 'info' | 'positive' | 'warning' | 'danger'

export const notice = (o: {
  tone?: NoticeTone
  title: string
  message: string
  icon?: JSXChild
  actions?: JSXChild
}): TemplateResult => (
  <aside data-ui="notice" data-tone={o.tone ?? 'info'} role={o.tone === 'danger' ? 'alert' : 'status'}>
    {o.icon !== undefined && (
      <span data-ui="notice-icon" aria-hidden="true">
        {o.icon}
      </span>
    )}
    <div data-ui="notice-copy">
      <p data-ui="notice-title">{o.title}</p>
      <p data-ui="notice-message">{o.message}</p>
    </div>
    {o.actions !== undefined && <div data-ui="notice-actions">{o.actions}</div>}
  </aside>
)

export const emptyState = (
  message: string,
  hint: string,
  o: { icon?: JSXChild; actions?: JSXChild } = {},
): TemplateResult => (
  <div data-ui="empty" role="status">
    {o.icon !== undefined && (
      <span data-ui="empty-icon" aria-hidden="true">
        {o.icon}
      </span>
    )}
    <p data-ui="empty-message">{message}</p>
    <p data-ui="empty-hint">{hint}</p>
    {o.actions !== undefined && <div data-ui="empty-actions">{o.actions}</div>}
  </div>
)

export const errorState = (code: string, message: string, hint: string): TemplateResult => (
  <div data-ui="error" role="alert">
    <p data-ui="error-code">{code}</p>
    <p data-ui="error-message">{message}</p>
    {!!hint && <p data-ui="error-hint">{hint}</p>}
  </div>
)

/** A labelled skeleton that preserves the broad shape of the content arriving. */
export const loadingState = (label: string, lines = 3): TemplateResult => (
  <div data-ui="loading" role="status" aria-live="polite">
    <span data-ui="loading-label">{label}</span>
    <div data-ui="skeleton" aria-hidden="true">
      {each(
        Array.from({ length: Math.max(1, lines) }),
        (_, i) => i,
        (_, i) => (
          <span data-ui="skeleton-line" data-line={String(i + 1)} />
        ),
      )}
    </div>
  </div>
)
