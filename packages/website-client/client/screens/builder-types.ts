// Shapes the page builder's parts share: the draft one page is edited in, and the editor surface
// the builder lends its panels, toolbar and dialogs.
import type { Entry, MenuItem, Placement, SiteTheme } from '../types.ts'

/** One section type the site offers: its name and its settings (name → field kind). */
export type SectionDefinition = { title: string; settings?: Record<string, string> }
export type SectionCatalogue = Record<string, SectionDefinition>

/** `website.getEntry` for the builder: the page and the sections it may hold. */
export type BuilderEntry = { entry: Entry; sections: SectionCatalogue }

/** A page's unsaved layout, with its undo history. `base` is the revision it was read at. */
export type BuilderDraft = {
  entry: Entry
  layout: Placement[]
  base: string
  dirty: boolean
  past: Placement[][]
  future: Placement[][]
  /** Edits with the same key (typing into one field) undo as one step. */
  lastEdit: string | null
}

/** A page template: the first hero and text a new or replaced page starts from. */
export type PageTemplate = {
  id: string
  title: string
  heading?: string
  ctaLabel?: string
  ctaHref?: string
  body?: string
}

/** What the builder lends its panels: the current draft and the ways to change it. */
export type BuilderEditor = {
  draft: () => BuilderDraft
  change: (mutate: (layout: Placement[]) => unknown) => void
  save: () => Promise<void>
  touch: () => void
  templates: () => PageTemplate[]
}

/** A menu every page shares, as the entry's history lists it. */
export type SharedMenu = { kind: 'menus'; id: string; title: string; position?: string; items?: MenuItem[] }
export type SharedTheme = { kind: 'themes' } & SiteTheme

/** One saved revision of a page or post. */
export type EntryRevision = {
  id: string
  revisionId: string
  title: string
  updatedBy: string
  updatedAt: string
  digest?: string
}

/** `website_studio.entryHistory`: saved revisions, the live one, and the site-wide resources. */
export type EntryHistory = {
  entry: Entry
  liveRevisionId?: string | null
  revisions: EntryRevision[]
  resources?: (SharedMenu | SharedTheme)[]
}

/** One line of `website.diffRevisions`: a section added, removed or changed, and what changed. */
export type RevisionChange = { id: string; change: string; fields?: string[]; path?: string }
