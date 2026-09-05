import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Tone } from '../primitives/status.tsx'

export const HOOKS = [
  'pipeline',
  'pipeline-step',
  'pipeline-arrow',
  'pipeline-step-label',
  'pipeline-step-value',
  'pipeline-step-node',
] as const

export type PipelineStep = {
  id: string
  label: string
  value: string | number
  href?: string | null
  tone?: Tone
}

/**
 * A process read left to right: the stages of a thing, and how many are sitting
 * in each one.
 *
 * Not a `Progress`, which answers "how far along is this one record". This
 * answers "where is the work piling up", so every stage carries its own count
 * and none of them is a percentage of the others — a stage can hold more than
 * the one before it, and a bar that normalised them would say the opposite.
 *
 * An ordered list, because the order is the meaning. The connecting rail and the
 * arrows between stages are drawn by the stylesheet from `pipeline-step-node`
 * and `pipeline-arrow`; both are decoration for an order the markup already
 * states, which is why the arrow carries no text to announce.
 */
export const Pipeline = (props: { label: string; steps: readonly PipelineStep[] }): TemplateResult => (
  <ol data-ui="pipeline" aria-label={props.label}>
    {each(
      props.steps,
      (step) => step.id,
      (step) => (
        <li data-ui="pipeline-step" data-tone={step.tone ?? 'neutral'}>
          <span data-ui="pipeline-arrow" aria-hidden="true" />
          {step.href ? (
            <a data-ui="pipeline-step-label" href={step.href}>
              {step.label}
            </a>
          ) : (
            <span data-ui="pipeline-step-label">{step.label}</span>
          )}
          <span data-ui="pipeline-step-value">{String(step.value)}</span>
          <span data-ui="pipeline-step-node" aria-hidden="true" />
        </li>
      ),
    )}
  </ol>
)
