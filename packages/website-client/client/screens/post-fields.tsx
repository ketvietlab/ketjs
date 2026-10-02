import { Grid, TextField, TextArea, Select, Field } from '@ketvietlab/design-system'
import type { Entry, StudioContext, TaxonomyTerm } from '../types.ts'

export const POST_KEYS = ['author', 'excerpt', 'category', 'cover', 'coverAlt', 'publishedAt'] as const
export type PostFieldValues = Record<(typeof POST_KEYS)[number], string> & { tags: string[] }
export const readPostFields = (form: FormData): PostFieldValues => ({
  ...(Object.fromEntries(POST_KEYS.map((k) => [k, String(form.get(k) ?? '').trim()])) as Record<
    (typeof POST_KEYS)[number],
    string
  >),
  tags: (form.getAll?.('tags') as string[] | undefined) ?? [],
})
export function postFields(
  ctx: StudioContext,
  entry: Partial<Entry> = {},
  terms: readonly TaxonomyTerm[] = [],
  columns: 1 | 2 | 3 | 4 = 2,
) {
  return (
    <Grid
      // One column has no Grid rule of its own; the grid's single-column base applies.
      columns={columns as 2 | 3 | 4}
      items={[
        ...POST_KEYS.map((key) => {
          const props = {
            id: `post-${key}`,
            name: key,
            label: ctx.tr(`website.post.${key}`),
            value: entry[key] ?? '',
          }
          return key === 'category' ? (
            <Select
              {...props}
              options={[
                { value: '', label: ctx.tr('website.post.noCategory') },
                ...terms
                  .filter((r) => r.taxonomyType === 'category')
                  .map((r) => ({ value: r.id, label: r.title ?? '' })),
              ]}
            />
          ) : key === 'excerpt' ? (
            <TextArea {...props} />
          ) : key === 'publishedAt' ? (
            <Field {...props} type="date" />
          ) : (
            <TextField {...props} />
          )
        }),
        <Field
          id="post-tags"
          name="tags"
          label={ctx.tr('website.post.tags')}
          type="checkbox-group"
          span="full"
          options={terms
            .filter((r) => r.taxonomyType === 'tag')
            .map((r) => ({
              name: 'tags',
              value: r.id,
              label: r.title ?? '',
              checked: (entry.tags ?? []).includes(r.id),
            }))}
        />,
      ]}
    />
  )
}
