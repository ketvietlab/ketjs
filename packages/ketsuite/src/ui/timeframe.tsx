import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { each } from '@ketvietlab/ketjs-view'
import { icon } from './icons.ts'

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

export type TimeframeFilterOptions = {
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
 * This is a filter, not navigation, and tabs said the opposite: tabs are for
 * sibling views of the same thing, and a reader who has learned that reads a row
 * of periods as five screens rather than one screen under five constraints.
 * Worse, a screen with real tabs above it ends up with two tab rows that look
 * alike and mean different things.
 *
 * Every option is a link, so the choice survives a copied URL, a bookmark and a
 * browser with no JavaScript. The control states the resolved range and the
 * moment the figures were computed beside the choice, because a period label on
 * its own does not say what a number covers.
 */
export const timeframeFilter = (o: TimeframeFilterOptions): TemplateResult => {
  const active = o.options.find((option) => option.active) ?? o.options[0]
  return (
    <div data-ui="timeframe" role="group" aria-label={o.label}>
      <details data-ui="timeframe-menu">
        <summary data-ui="timeframe-trigger" aria-label={o.label} title={o.label}>
          <span data-ui="timeframe-label">{o.label}</span>
          <span data-ui="timeframe-value">{active?.label ?? ''}</span>
          {icon('chevron-down')}
        </summary>
        <div data-ui="timeframe-content" id={`${o.id}-options`}>
          {each(
            o.options,
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
      {!!o.range && <span data-ui="timeframe-range">{o.range}</span>}
      {!!o.asOf && <span data-ui="timeframe-asof">{o.asOfLabel ? `${o.asOfLabel} ${o.asOf}` : o.asOf}</span>}
      {!!o.note && <span data-ui="timeframe-note">{o.note}</span>}
    </div>
  )
}
