import type { JointDef } from '@ketvietlab/ketjs'

/** Anything a module wants on every page goes through one of these, or not at all. */
export const joints: Record<string, JointDef> = {
  'page.head': { props: { page: 'website.page', meta: 'json?' } },
  'page.body.start': { props: { page: 'website.page' } },
  'page.body.end': { props: { page: 'website.page' } },
}
