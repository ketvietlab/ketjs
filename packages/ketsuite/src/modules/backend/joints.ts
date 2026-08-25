import type { JointDef } from '@ketvietlab/ketjs'

/**
 * What the backend screens let other modules into.
 *
 * Named, and only named: a fill addresses one of these and nothing else. That is
 * the difference from the domain contract's XPath, where an extension addresses a node upstream
 * never promised would exist — rename the field and every extension breaks. Here
 * the markup around a joint can change freely; the joint is the contract.
 *
 * `props` says what a fill receives, and receives nothing else.
 */
export const joints: Record<string, JointDef> = {
  /** Function-backed relational selector; owning screens supply model-specific capabilities. */
  'relation.select': { props: { id: 'id', config: 'json' } },
  /**
   * Sidebar entries, after the ones backend owns.
   *
   * `active` is the screen currently shown, so a fill can mark itself. It is a
   * prop rather than something the fill works out, because working it out would
   * mean reading the URL, and a fill that reads the request is a fill that can be
   * surprised by one.
   *
   * `lang` for the same reason `sidebar.foot` takes one: an island is handed
   * props and nothing else — no context, no translator — so a fill with words
   * in it has no other way to know which language to say them in.
   */
  'nav.items': { props: { active: 'text', lang: 'text?' }, multiple: true },
  /** The far end of the topbar, before the identity strip. */
  'topbar.end': { multiple: true },
  // The foot of the sidebar: a module with a queue of anything can put its count
  // there, beside who you are signed in as.
  'sidebar.foot': { props: { lang: 'text?' }, multiple: true },
}
