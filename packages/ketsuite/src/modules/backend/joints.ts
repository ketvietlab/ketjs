import type { JointDef } from 'ketjs'

/**
 * What the backend screens let other modules into.
 *
 * Named, and only named: a fill addresses one of these and nothing else. That is
 * the difference from Odoo's XPath, where an extension addresses a node upstream
 * never promised would exist — rename the field and every extension breaks. Here
 * the markup around a joint can change freely; the joint is the contract.
 *
 * `props` says what a fill receives, and receives nothing else.
 */
export const joints: Record<string, JointDef> = {
  /**
   * Sidebar entries, after the ones backend owns.
   *
   * `active` is the screen currently shown, so a fill can mark itself. It is a
   * prop rather than something the fill works out, because working it out would
   * mean reading the URL, and a fill that reads the request is a fill that can be
   * surprised by one.
   */
  'nav.items': { props: { active: 'text' }, multiple: true },
  /** Beside Install/Remove on an app card. */
  'app-card.actions': { props: { app: 'json' }, multiple: true },
  /** The far end of the topbar, before the identity strip. */
  'topbar.end': { multiple: true },
  /** Under the last group on the apps screen. */
  'apps.footer': { multiple: true },
}
