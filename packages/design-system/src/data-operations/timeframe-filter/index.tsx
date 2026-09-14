import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'timeframe',
  'timeframe-menu',
  'timeframe-trigger',
  'timeframe-label',
  'timeframe-value',
  'timeframe-content',
  'timeframe-option',
  'timeframe-option-label',
  'timeframe-option-detail',
  'timeframe-range',
  'timeframe-asof',
  'timeframe-note',
] as const

export type TimeframeOption = {
  id: string
  label: string
  href: string
  active?: boolean
  /** Shown under the option, e.g. the dates the preset resolves to. */
  detail?: string | null
}

export type TimeframeFilterProps = {
  id: string
  /** What is being filtered, e.g. "Reporting period". Also the group's label. */
  label: string
  options: readonly TimeframeOption[]
  /** The range the active option resolves to, e.g. "2026-08-06 → 2026-09-05". */
  range?: string | null
  /** When the figures were computed, and the words for it. */
  asOf?: string | null
  asOfLabel?: string | null
  /** Trailing note, e.g. the timezone the range is expressed in. */
  note?: string | null
}

/**
 * The period a screen is reporting on.
 *
 * A filter, not navigation: tabs mean sibling views, and a row of periods read
 * as tabs looks like five screens rather than one screen under five constraints.
 * Every option is a link, so the choice survives a copied URL and needs no
 * script. The resolved range and the build time sit beside the choice, because
 * a period label alone does not say what a number covers.
 */
export const TimeframeFilter = (props: TimeframeFilterProps): TemplateResult => {
  const active = props.options.find((option) => option.active) ?? props.options[0]
  return (
    <div data-ui="timeframe" role="group" aria-label={props.label}>
      <details data-ui="timeframe-menu">
        <summary data-ui="timeframe-trigger" aria-label={props.label} title={props.label}>
          <span data-ui="timeframe-label">{props.label}</span>
          <span data-ui="timeframe-value">{active?.label ?? ''}</span>
        </summary>
        <div data-ui="timeframe-content" id={`${props.id}-options`}>
          {each(
            props.options,
            (option) => option.id,
            (option) => (
              <a
                data-ui="timeframe-option"
                data-active={String(option.active === true)}
                aria-current={option.active === true ? 'true' : null}
                href={option.href}
              >
                <span data-ui="timeframe-option-label">{option.label}</span>
                {!!option.detail && <small data-ui="timeframe-option-detail">{option.detail}</small>}
              </a>
            ),
          )}
        </div>
      </details>
      {!!props.range && <span data-ui="timeframe-range">{props.range}</span>}
      {!!props.asOf && (
        <span data-ui="timeframe-asof">
          {props.asOfLabel ? `${props.asOfLabel} ${props.asOf}` : props.asOf}
        </span>
      )}
      {!!props.note && <span data-ui="timeframe-note">{props.note}</span>}
    </div>
  )
}
