import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Tone } from '../../primitives/status/index.tsx'

export const HOOKS = [
  'toast-region',
  'toast',
  'toast-copy',
  'toast-title',
  'toast-message',
  'toast-actions',
] as const

export type ToastProps = {
  id: string
  title: string
  message?: string
  tone?: Tone
  actions?: JSXChild
}

export const Toast = (props: ToastProps): TemplateResult => (
  <article
    data-ui="toast"
    data-tone={props.tone ?? 'neutral'}
    role={props.tone === 'danger' ? 'alert' : 'status'}
  >
    <div data-ui="toast-copy">
      <strong data-ui="toast-title">{props.title}</strong>
      {props.message && <p data-ui="toast-message">{props.message}</p>}
    </div>
    {props.actions !== undefined && <div data-ui="toast-actions">{props.actions}</div>}
  </article>
)

export const ToastRegion = (props: { label: string; toasts: readonly ToastProps[] }): TemplateResult => (
  <section data-ui="toast-region" aria-label={props.label} aria-live="polite" aria-relevant="additions text">
    {each(
      props.toasts,
      (toast) => toast.id,
      (toast) => (
        <Toast {...toast} />
      ),
    )}
  </section>
)
