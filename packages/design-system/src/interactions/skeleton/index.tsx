import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['skeleton', 'skeleton-line'] as const

export const Skeleton = (props: { label: string; lines?: number }): TemplateResult => (
  <div data-ui="skeleton" role="status" aria-label={props.label}>
    {each(
      Array.from({ length: Math.max(1, props.lines ?? 3) }),
      (_, index) => index,
      (_, index) => (
        <span data-ui="skeleton-line" data-line={String(index + 1)} />
      ),
    )}
  </div>
)
