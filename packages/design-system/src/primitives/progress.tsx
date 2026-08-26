import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'progress',
  'progress-label',
  'progress-value',
  'progress-track',
  'progress-bar',
] as const

export type ProgressTone = 'primary' | 'positive' | 'warning' | 'danger'

export const Progress = (props: {
  value: number
  label: string
  tone?: ProgressTone
  showValue?: boolean
}): TemplateResult => {
  const value = Math.max(0, Math.min(100, props.value))
  return (
    <div data-ui="progress" data-tone={props.tone ?? 'primary'}>
      {(props.showValue ?? true) && (
        <div data-ui="progress-label">
          <span>{props.label}</span>
          <span data-ui="progress-value">{`${value}%`}</span>
        </div>
      )}
      <div
        data-ui="progress-track"
        role="progressbar"
        aria-label={props.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={String(value)}
      >
        <span data-ui="progress-bar" style={`width: ${value}%`} />
      </div>
    </div>
  )
}
