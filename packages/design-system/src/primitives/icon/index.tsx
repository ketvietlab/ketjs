import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['icon'] as const

// Lucide glyphs (ISC). Keep their original 24px viewBox and stroke geometry.
const glyphs = {
  plus: () => <path d="M12 5v14M5 12h14" />,
  x: () => <path d="m18 6-12 12M6 6l12 12" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  check: () => <path d="m20 6-11 11-5-5" />,
  minus: () => <path d="M5 12h14" />,
  'chevron-down': () => <path d="m6 9 6 6 6-6" />,
  'chevron-right': () => <path d="m9 18 6-6-6-6" />,
  info: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  'circle-check': () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  'triangle-alert': () => (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  'circle-alert': () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  inbox: () => (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>
  ),
} satisfies Record<string, () => TemplateResult>

export type IconName = keyof typeof glyphs
export type IconProps = {
  name: IconName
  size?: 'small' | 'default' | 'large'
  tone?: 'inherit' | 'muted' | 'info' | 'positive' | 'warning' | 'danger'
  /** Omit for decoration; the containing control owns its accessible name. */
  label?: string
}

export const Icon = (props: IconProps): TemplateResult => (
  <svg
    data-ui="icon"
    data-size={props.size ?? 'default'}
    data-tone={props.tone ?? 'inherit'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    role={props.label ? 'img' : undefined}
    aria-label={props.label ?? null}
    aria-hidden={props.label ? null : 'true'}
  >
    {glyphs[props.name]()}
  </svg>
)
