import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['skeleton', 'skeleton-line'] as const

export const Skeleton = (props: { label: string; lines?: number; decorative?: boolean }): TemplateResult => (
  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: only the announced status branch has an accessible label.
  <div
    data-ui="skeleton"
    role={props.decorative ? undefined : 'status'}
    aria-label={props.decorative ? null : props.label}
    aria-hidden={props.decorative ? 'true' : null}
  >
    {each(
      Array.from({
        length: Math.max(1, Math.min(20, Math.trunc(Number.isFinite(props.lines) ? (props.lines ?? 3) : 3))),
      }),
      (_, index) => index,
      (_, index) => (
        <span data-ui="skeleton-line" data-line={String(index + 1)} />
      ),
    )}
  </div>
)
