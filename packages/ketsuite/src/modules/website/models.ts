import type { ModelDef } from 'ketjs'

/**
 * A page's body is not markup and not code: `layout` holds an ordered list of
 * section placements. That is what lets an agent edit a page by writing validated
 * data, and a theme render it without either side writing the other's half.
 */
export const models: Record<string, ModelDef> = {
  Page: {
    // Website content belongs to a legal entity, not to a branch: two branches of
    // one company share a site.
    scope: 'company',
    fields: {
      id: 'id',
      path: 'text',
      title: 'text',
      layout: 'json',
      published: 'bool',
      updatedAt: 'datetime',
    },
  },
}
