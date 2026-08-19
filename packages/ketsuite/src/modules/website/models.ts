import type { ModelDef } from 'ketjs'

/**
 * A page's body is not markup and not code: `layout` holds an ordered list of
 * section placements. That is what lets an agent edit a page by writing validated
 * data, and a theme render it without either side writing the other's half.
 */
export const models: Record<string, ModelDef> = {
  Page: {
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
