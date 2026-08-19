/**
 * The lego pillar on a real model: fields added to a page this module does not own.
 * Every one is optional, because pages already exist that have no value for them —
 * a rule the composer enforces rather than trusts.
 */
export const extend: Record<string, Record<string, string>> = {
  'website.Page': {
    metaDescription: 'text?',
    canonical: 'text?',
    noindex: 'bool?',
    ogImage: 'text?',
  },
}
