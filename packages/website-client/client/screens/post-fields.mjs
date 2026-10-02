import { Grid, TextField, TextArea, Select, Field } from '@ketvietlab/design-system'
import { h } from '../ui.mjs'
export const POST_KEYS = ['author', 'excerpt', 'category', 'cover', 'coverAlt', 'publishedAt']
export const readPostFields = (form) => ({
  ...Object.fromEntries(POST_KEYS.map((k) => [k, String(form.get(k) ?? '').trim()])),
  tags: form.getAll?.('tags') ?? [],
})
export function postFields(ctx, entry = {}, terms = [], columns = 2) {
  return h(Grid, {
    columns,
    items: [
      ...POST_KEYS.map((key) => {
        const props = {
          id: `post-${key}`,
          name: key,
          label: ctx.tr(`website.post.${key}`),
          value: entry[key] ?? '',
        }
        return key === 'category'
          ? h(Select, {
              ...props,
              options: [
                { value: '', label: ctx.tr('website.post.noCategory') },
                ...terms
                  .filter((r) => r.taxonomyType === 'category')
                  .map((r) => ({ value: r.id, label: r.title })),
              ],
            })
          : h(key === 'excerpt' ? TextArea : TextField, {
              ...props,
              type: key === 'publishedAt' ? 'date' : 'text',
            })
      }),
      h(Field, {
        id: 'post-tags',
        name: 'tags',
        label: ctx.tr('website.post.tags'),
        type: 'checkbox-group',
        span: 'full',
        options: terms
          .filter((r) => r.taxonomyType === 'tag')
          .map((r) => ({
            name: 'tags',
            value: r.id,
            label: r.title,
            checked: (entry.tags ?? []).includes(r.id),
          })),
      }),
    ],
  })
}
