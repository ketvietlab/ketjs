// Core resource schemas; fixture data lives in the Atlas host.

/** `text`, `area`, `number`, or `select:a,b` with its option values. */
export type ResourceField = {
  name: string
  label: string
  kind: string
  required?: boolean
  defaultValue?: string
}
export type ResourceSchema = { group: string; capability: string; fields: ResourceField[] }

/**
 * A record of any resource kind: the fields its schema names, read by name, and what a kind adds
 * around them (a theme's compatibility, a menu's broken links, a term's possible parents).
 */
export type ResourceRecord = {
  id: string
  revisionId?: string | null
  title?: string
  kind?: string
  version?: string
  compatibility?: unknown[]
  warnings?: { target: string; state: string }[]
  usage?: { title: string }[]
  affected?: { id: string }[]
  companyId?: string
  taxonomyId?: string
  items?: unknown
  schema?: { fields?: unknown } | null
  sets?: { id: string; title: string }[]
  parents?: { id: string; title: string }[]
  [field: string]: unknown
}
/** Resource values are the text (or count) their fields edit. */
export const resourceValue = (value: unknown) => value as string | number | undefined

export const resourceSchemas: Record<string, ResourceSchema> = {
  'taxonomy-sets': {
    group: 'content',
    capability: 'website.content.write',
    fields: [
      { name: 'title', label: 'website.resource.taxonomySet.title', kind: 'text', required: true },
      { name: 'key', label: 'website.resource.taxonomySet.key', kind: 'text', required: true },
      {
        name: 'scope',
        label: 'website.resource.taxonomySet.scope',
        kind: 'select:page,post',
        defaultValue: 'post',
      },
      { name: 'path', label: 'website.resource.taxonomySet.path', kind: 'text', defaultValue: '/topics' },
      {
        name: 'hierarchical',
        label: 'website.resource.taxonomySet.hierarchical',
        kind: 'select:yes,no',
        defaultValue: 'yes',
      },
    ],
  },
  taxonomy: {
    group: 'content',
    capability: 'website.content.write',
    fields: [
      { name: 'description', label: 'website.taxonomy.description', kind: 'area' },
      { name: 'descriptionDoc', label: 'website.taxonomy.description', kind: 'text' },
      { name: 'thumbnail', label: 'website.taxonomy.thumbnail', kind: 'text' },
      { name: 'thumbnailAlt', label: 'website.taxonomy.imageAlt', kind: 'text' },
      { name: 'cover', label: 'website.taxonomy.cover', kind: 'text' },
      { name: 'coverAlt', label: 'website.taxonomy.imageAlt', kind: 'text' },
      { name: 'seoTitle', label: 'website.taxonomy.seoTitle', kind: 'text' },
      { name: 'seoDescription', label: 'website.taxonomy.seoDescription', kind: 'area' },
      { name: 'canonical', label: 'website.resource.seo.canonical', kind: 'text' },
      {
        name: 'indexing',
        label: 'website.taxonomy.indexing',
        kind: 'select:index,noindex',
        defaultValue: 'index',
      },

      {
        name: 'taxonomyId',
        label: 'website.resource.taxonomySet.title',
        kind: 'text',
      },
      {
        name: 'title',
        label: 'website.resource.taxonomy.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'slug',
        label: 'website.resource.taxonomy.slug',
        kind: 'text',
        required: false,
      },
      {
        name: 'taxonomyType',
        label: 'website.resource.taxonomy.kind',
        kind: 'select:category,tag',
        required: false,
      },
      {
        name: 'parent',
        label: 'website.resource.taxonomy.parent',
        kind: 'text',
        required: false,
      },
    ],
  },
  menus: {
    group: 'experience',
    capability: 'website.content.write',
    fields: [
      {
        name: 'title',
        label: 'website.resource.menus.title',
        kind: 'text',
        required: true,
      },
      { name: 'locale', label: 'website.entry.locale', kind: 'select:vi,en', defaultValue: 'vi' },
      {
        name: 'position',
        label: 'website.resource.menus.position',
        kind: 'select:header,footer',
        required: false,
      },
      {
        name: 'items',
        label: 'website.resource.menus.links',
        kind: 'area',
        required: false,
      },
    ],
  },
  domains: {
    group: 'settings',
    capability: 'website.site.manage',
    fields: [{ name: 'title', label: 'website.resource.domains.title', kind: 'text', required: true }],
  },
  'form-editor': {
    group: 'experience',
    capability: 'website.form.manage',
    fields: [
      {
        name: 'title',
        label: 'website.resource.form-editor.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'schema',
        label: 'website.resource.form-editor.fields',
        kind: 'area',
        required: true,
      },
      {
        name: 'recipient',
        label: 'website.resource.form-editor.recipient',
        kind: 'text',
        required: false,
      },
      {
        name: 'successMessage',
        label: 'website.resource.form-editor.successMessage',
        kind: 'area',
        required: false,
      },
      {
        name: 'consentLabel',
        label: 'website.resource.form-editor.consentLabel',
        kind: 'text',
        required: false,
      },
      {
        name: 'spamProtection',
        label: 'website.resource.form-editor.spamProtection',
        kind: 'select:honeypot,challenge',
        required: false,
      },
      {
        name: 'active',
        label: 'website.resource.form-editor.active',
        kind: 'select:yes,no',
        required: false,
      },
      // The ERP module a submission is handed to; offered only where the host composes one.
      {
        name: 'destination',
        label: 'website.resource.form-editor.destination',
        kind: 'destination',
        required: false,
      },
    ],
  },
  seo: {
    group: 'experience',
    capability: 'website.content.write',
    fields: [
      {
        name: 'title',
        label: 'website.resource.seo.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'path',
        label: 'website.resource.seo.path',
        kind: 'text',
        required: false,
      },
      {
        name: 'description',
        label: 'website.resource.seo.description',
        kind: 'area',
        required: false,
      },
      {
        name: 'image',
        label: 'website.resource.seo.image',
        kind: 'text',
        required: false,
      },
      {
        name: 'indexing',
        label: 'website.resource.seo.indexing',
        kind: 'select:index,noindex',
        required: false,
      },
      {
        name: 'canonical',
        label: 'website.resource.seo.canonical',
        kind: 'text',
        required: false,
      },
    ],
  },
  sites: {
    group: 'settings',
    capability: 'website.site.manage',
    fields: [
      { name: 'companyId', label: 'website.site.companyField', kind: 'text' },
      { name: 'code', label: 'website.site.code', kind: 'text' },
      { name: 'timezone', label: 'website.site.timezone', kind: 'text', defaultValue: 'Asia/Ho_Chi_Minh' },
      {
        name: 'state',
        label: 'website.site.state',
        kind: 'select:draft,active,paused',
        defaultValue: 'draft',
      },
      { name: 'realm', label: 'website.site.realm', kind: 'text', defaultValue: 'customers' },
      { name: 'retentionDays', label: 'website.site.retentionDays', kind: 'text', defaultValue: '90' },
      { name: 'consentVersion', label: 'website.site.consentVersion', kind: 'text', defaultValue: 'v1' },
      { name: 'authReady', label: 'website.site.authReady', kind: 'select:yes,no', defaultValue: 'no' },

      {
        name: 'title',
        label: 'website.resource.sites.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'host',
        label: 'website.resource.sites.host',
        kind: 'text',
        required: true,
      },
      {
        name: 'defaultLocale',
        label: 'website.resource.sites.defaultLocale',
        kind: 'select:vi,en',
        required: false,
      },
    ],
  },
  themes: {
    group: 'experience',
    capability: 'website.site.manage',
    fields: [
      {
        name: 'preset',
        label: 'website.resource.themes.preset',
        kind: 'select:default,cosmetics',
        defaultValue: 'default',
      },
      {
        name: 'spacing',
        label: 'website.resource.themes.spacing',
        kind: 'select:compact,comfortable,spacious',
        defaultValue: 'comfortable',
      },
      {
        name: 'buttons',
        label: 'website.resource.themes.buttons',
        kind: 'select:rounded,square',
        defaultValue: 'rounded',
      },
      {
        name: 'account',
        label: 'website.resource.themes.account',
        kind: 'select:hidden,shown',
        defaultValue: 'hidden',
      },
      {
        name: 'title',
        label: 'website.resource.themes.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'accent',
        label: 'website.resource.themes.accent',
        kind: 'select:indigo,green,orange',
        required: false,
      },
      {
        name: 'font',
        label: 'website.resource.themes.font',
        kind: 'select:sans,serif',
        required: false,
      },
      {
        name: 'logo',
        label: 'website.resource.themes.logo',
        kind: 'text',
        required: false,
      },
      {
        name: 'footer',
        label: 'website.resource.themes.footer',
        kind: 'area',
        required: false,
      },
    ],
  },
  templates: {
    group: 'content',
    capability: 'website.content.write',
    fields: [
      {
        name: 'title',
        label: 'website.resource.templates.title',
        kind: 'text',
        required: true,
      },
      {
        name: 'heading',
        label: 'website.resource.templates.heading',
        kind: 'text',
        required: false,
      },
      {
        name: 'body',
        label: 'website.resource.templates.body',
        kind: 'area',
        required: false,
      },
      {
        name: 'ctaLabel',
        label: 'website.resource.templates.ctaLabel',
        kind: 'text',
        required: false,
      },
      {
        name: 'ctaHref',
        label: 'website.resource.templates.ctaHref',
        kind: 'text',
        required: false,
      },
    ],
  },
}
