// Shapes the Studio shares between its island, its screens and extension instances. Server
// payloads are typed where they are read; these are only the ones every screen meets.
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Tone } from '@ketvietlab/design-system'

export type { Tone }

/** A rendered piece of a page: a template, nothing, or text. */
export type View = TemplateResult | string | null | undefined

/** A matched route: its key, its path parameters and the query it keeps. */
export type WebsiteLocation = {
  key: string
  params: Record<string, string>
  query: Record<string, string>
}

export type CallOptions = { signal?: AbortSignal; key?: string }
/** One `/_ket/fn` request. The caller names the shape it reads back. */
export type Call = <T = unknown>(name: string, input?: object, options?: CallOptions) => Promise<T>

export type Toast = { id: string; title: string; tone: Tone }

export type Site = {
  id: string
  name: string
  host: string
  locales: string[]
  defaultLocale?: string
  timezone: string
  revisionId?: string
}
export type SiteChoice = { id: string; name: string; host: string }
export type Actor = { id?: string; name: string; role: string; capabilities: string[] }
export type Company = { id: string; name: string }
/** What the Studio knows before any route reads: who is here and which site they work on. */
export type Boot = {
  actor: Actor
  site: Site | null
  sites: SiteChoice[]
  companies?: Company[]
  /** Commercial offer for the next edition; null when none applies. */
  offer: { title: string; message: string; label: string; href: string } | null
  home: string
}

/** Arguments a command button carries, and the form a submit button sends with it. */
export type CommandArgs = Record<string, string>
export type Command = (args: CommandArgs, form?: FormData) => unknown
export type Commands = Record<string, Command>

export type PageMetadata = {
  title: string
  description: string
  robots: string
  canonical: string | null
  image: string
}

/** A core screen answers the same questions as an extension route. */
/** A core screen answers the same questions as an extension route. `view` gets back what `read`
 *  returned, so the table of screens holds each with its own value type (method syntax keeps a
 *  `Screen<Overview>` usable where a `Screen` is expected). */
export type Screen<T = unknown> = {
  read?: ((route: WebsiteLocation, signal: AbortSignal) => Promise<T> | T) | null
  view(value: T, route: WebsiteLocation): View
  readKey?(route: WebsiteLocation): unknown
  commands?: Commands
  metadata?(value: T): PageMetadata | null
  /** Drops what the screen attached to the document (listeners, drag sessions). */
  dispose?(): void
}

/** Where an uploaded image is attached; the record keeps only the reference until it saves. */
export type ImageOwner = { id: string; field: string; resModel?: string }
export type ImageUploadOptions = ImageOwner & {
  siteId: string
  signal?: AbortSignal
  headers?: Record<string, string>
}
export type ImageUpload = (file: File, options: ImageUploadOptions) => Promise<{ id: string; url: string }>

export type NavigateOptions = { replace?: boolean }

/** Shared with every screen and extension instance. Nothing here grants authority. */
export type StudioContext = {
  tr: (key: string, params?: Record<string, string | number>) => string
  call: Call
  uploadImage: ImageUpload
  href: (key: string, params?: Record<string, string>, query?: Record<string, unknown>) => string
  can: (capability?: string | null) => boolean
  notify: (title: string, tone?: Tone) => void
  navigate: (
    key: string,
    params?: Record<string, string>,
    query?: Record<string, unknown>,
    options?: NavigateOptions,
  ) => Promise<void>
  route: () => WebsiteLocation
  boot: () => Boot
  theme: () => 'dark' | 'light'
  /** The selected site. Site-scoped screens only render once the bootstrap chose one. */
  site: () => Site
  busy: () => boolean
  toasts: () => Toast[]
  refresh: () => Promise<void>
  reload: () => Promise<void>
  slot: (hook: 'overviewCard' | 'siteSettingsSection', value: unknown) => View[]
}

export type Viewport = 'desktop' | 'tablet' | 'mobile'
/** Width, spacing and alignment one viewport overrides; the desktop values are the base. */
export type ResponsiveSettings = {
  minWidth?: number
  maxWidth?: number
  spacing?: string
  align?: string
}
/** A section's settings as the editor saved them. Known keys are typed; a section may keep more. */
export type SectionSettings = {
  heading?: string
  subheading?: string
  body?: string
  caption?: string
  author?: string
  image?: string
  image2?: string
  alt?: string
  imageFit?: string
  imageRatio?: string
  focalX?: number | string
  focalY?: number | string
  ctaLabel?: string
  ctaHref?: string
  videoUrl?: string
  align?: string
  textColor?: string
  backgroundColor?: string
  locale?: string
  profile?: string
  visibility?: string
  layoutMode?: string
  gap?: string
  formId?: string
  responsive?: Partial<Record<Viewport, ResponsiveSettings>>
  [key: string]: unknown
}
/** One section on a page (`Placement`, the unit `website.saveEntry` stores). */
export type Placement = {
  id: string
  type: string
  settings?: SectionSettings
  /** Containers (columns) keep their children per named slot. */
  slots?: Record<string, Placement[]>
}

/** A form field as `website_form.Form.schema.fields` stores it. */
export type FormField = {
  id?: string
  name: string
  label: string
  type: string
  required: boolean
  maxLength: number
  classification: string
}

/** A navigation link as `website_menu.MenuItem` stores it; `parentId` nests it under another. */
export type MenuItem = {
  id: string
  label: string
  href: string
  parentId: string | null
  position: number
}

export type Translate = StudioContext['tr']

export type EntrySeo = {
  title?: string
  description?: string
  canonical?: string
  indexing?: string
  image?: string
}
/** A page or post as `website.getEntry` answers it: its draft, and where it stands publicly. */
export type Entry = {
  id: string
  type: string
  title: string
  path: string
  locale: string
  state: string
  revisionId: string
  layout: Placement[]
  seo?: EntrySeo | null
  slug?: string
  excerpt?: string
  cover?: string
  coverAlt?: string
  author?: string
  category?: string
  tags?: string[]
  /** A post's body as LiveDoc blocks (JSON); pages keep only a layout. */
  bodyDoc?: string | null
  bodyText?: string
  publishAt?: string | null
  publishedAt?: string | null
  scheduledRevisionId?: string | null
  scheduleFailure?: { code?: string; message: string; at?: string } | null
  trashed?: boolean
  updated?: string
  updatedAt?: string
  updatedBy?: string
}

/** A site's theme resource: the look every page shares, and the footer text. */
export type SiteTheme = {
  id?: string
  revisionId?: string
  title?: string
  preset?: string
  accent?: string
  font?: string
  spacing?: string
  buttons?: string
  account?: string
  footer?: string
  logo?: string
}

/** A category or tag as `website_taxonomy.Term` answers it; a new one has no revision yet. */
export type TaxonomyTerm = {
  id: string
  revisionId: string | null
  taxonomyType: string
  taxonomyId?: string
  title?: string
  slug?: string
  description?: string
  descriptionDoc?: string | null
  thumbnail?: string
  thumbnailAlt?: string
  cover?: string
  coverAlt?: string
  parent?: string
  seoTitle?: string
  seoDescription?: string
  canonical?: string
  indexing?: string
  postCount?: number
  usage?: { kind: string; id: string; title: string }[]
}
