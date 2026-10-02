import { cancelSchedule, EntrySchedule, publishEntry, scheduleTime } from './entry-publishing.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  RecordPage,
  Surface,
  Section,
  Stack,
  TextField,
  TextArea,
  Select,
  CheckboxGroup,
  Disclosure,
  LinkButton,
  Notice,
  Status,
} from '@ketvietlab/design-system'
import { h, CommandButton, fragments } from '../ui.mjs'
import { LiveDescription } from '../live-description.mjs'
import { AttachmentImage } from '../image-upload.mjs'
import { ArchiveActions } from '../archive-actions.mjs'
import { postDocument, postLegacyLayout, renderEntryBody } from '../post-document.mjs'
import { readPostFields } from './post-fields.mjs'
import { entryStatus, newId } from './format.mjs'

export function createPostEditor(ctx, isNew = false) {
  const tr = ctx.tr
  const prefix = isNew ? 'postCreate' : 'postEditor'
  let current = null,
    terms = [],
    pendingId = null
  const writable = () => ctx.can('website.content.write') && !current?.trashed
  const input = (name, label, value, area = false) =>
    h(area ? TextArea : TextField, {
      id: `post-${name}`,
      name,
      label,
      value: value ?? '',
      disabled: !writable(),
    })
  const save = async (form) => {
    if (!writable()) throw Object.assign(new Error(tr('website.resource.validation')), { code: 'forbidden' })
    const title = String(form.get('title') ?? '').trim(),
      path = String(form.get('path') ?? '').trim()
    if (!title || !path.startsWith('/'))
      throw Object.assign(new Error(tr('website.page.invalid')), { code: 'validation' })
    const result = await ctx.call(
      'website.saveEntry',
      {
        ...current,
        ...readPostFields(form),
        id: current.id,
        siteId: ctx.site().id,
        type: 'post',
        title,
        path,
        slug: path.slice(1),
        locale: String(form.get('locale') ?? current.locale),
        bodyDoc: String(form.get('descriptionDoc') ?? ''),
        seo: {
          title: String(form.get('seoTitle') ?? ''),
          description: String(form.get('seoDescription') ?? ''),
          canonical: String(form.get('canonical') ?? ''),
          indexing: String(form.get('indexing') ?? 'index'),
          image: String(form.get('cover') ?? ''),
        },
        layout: current.layout ?? [],
        expectedRevisionId: current.revisionId ?? null,
      },
      current.revisionId ? {} : { key: current.id },
    )
    current = { ...current, revisionId: result.revisionId }
    pendingId = null
    return result
  }
  return {
    readKey: (route) => route.params.id ?? 'new',
    read: async (route, signal) => {
      current = isNew
        ? {
            id: (pendingId ??= newId('post')),
            type: 'post',
            title: '',
            path: '/tin-tuc/',
            locale: ctx.site().locales[0],
            layout: [],
            state: 'draft',
            author: ctx.boot()?.actor?.name ?? '',
          }
        : (await ctx.call('website.getEntry', { id: route.params.id }, { signal })).entry
      if (current.type !== 'post' || (current.siteId && current.siteId !== ctx.site().id))
        throw Object.assign(new Error(tr('website.content.notFound')), { code: 'notFound' })
      terms = ctx.can('website.content.write')
        ? (
            await ctx.call(
              'website_studio.listResources',
              { siteId: ctx.site().id, kind: 'taxonomy' },
              { signal },
            )
          ).rows
        : []
      return current
    },
    view: (entry) => {
      const disabled = !writable() || ctx.busy()
      const button = (key, command, variant = 'secondary') =>
        CommandButton({ label: tr(key), command, form: 'post-editor', type: 'submit', variant, disabled })
      return h(RecordPage, {
        width: 'wide',
        title: isNew ? tr('website.route.postNew') : entry.title,
        actions: fragments([
          h(LinkButton, { label: tr('website.resource.back'), href: ctx.href('posts') }),
          !entry.trashed ? button('website.builder.preview', `${prefix}.preview`) : null,
          !entry.trashed
            ? button(
                'website.builder.save',
                `${prefix}.save`,
                ctx.can('website.publish') ? 'secondary' : 'primary',
              )
            : null,
          !entry.trashed && ctx.can('website.publish')
            ? button('website.entryPublish.now', `${prefix}.publish`, 'primary')
            : null,
          entry.revisionId
            ? ArchiveActions(ctx, {
                id: 'post-archive',
                title: entry.title,
                command: `${prefix}.archive`,
                disabled: ctx.busy() || !ctx.can('website.content.write'),
                restore: entry.trashed,
                extraItems: [
                  {
                    id: 'history',
                    label: tr('website.tools.history'),
                    href: ctx.href('entry-details', { id: entry.id }),
                  },
                ],
              })
            : null,
        ]),
        body: html`<form id="post-editor" novalidate><div class="website-post-workspace"><div class="website-post-content">${h(
          Stack,
          {
            items: [
              h(Surface, {
                title: tr('website.postEditor.content'),
                body: h(Stack, {
                  items: [
                    html`<div class="website-form-field">${h(TextField, { id: 'post-title', name: 'title', label: tr('website.entry.title'), value: entry.title, required: true, disabled: !writable() })}</div>`,
                    LiveDescription({
                      id: `post-${entry.id}`,
                      revision: entry.revisionId,
                      value: postDocument(entry),
                      label: tr('website.postEditor.body'),
                      readOnly: !writable(),
                      field: true,
                      images: { ctx, ownerId: entry.id, disabled: !entry.revisionId || !writable() },
                    }),
                  ],
                }),
              }),
              h(Surface, {
                title: tr('website.post.excerpt'),
                body: html`<div class="website-form-field">${input('excerpt', tr('website.postEditor.excerptHelp'), entry.excerpt, true)}</div>`,
              }),
              h(Surface, {
                title: tr('website.route.seo'),
                body: html`<div class="website-form-field">${h(Stack, {
                  items: [
                    input('seoTitle', tr('website.resource.seo.title'), entry.seo?.title),
                    input(
                      'seoDescription',
                      tr('website.resource.seo.description'),
                      entry.seo?.description,
                      true,
                    ),
                    input('canonical', tr('website.resource.seo.canonical'), entry.seo?.canonical),
                    h(Select, {
                      id: 'post-indexing',
                      name: 'indexing',
                      label: tr('website.resource.seo.indexing'),
                      value: entry.seo?.indexing ?? 'index',
                      disabled: !writable(),
                      options: [
                        { value: 'index', label: tr('website.option.index') },
                        { value: 'noindex', label: tr('website.option.noindex') },
                      ],
                    }),
                  ],
                })}</div>`,
              }),
              postLegacyLayout(entry.layout).length
                ? h(Surface, {
                    title: tr('website.postEditor.legacy'),
                    description: tr('website.postEditor.legacyHelp'),
                    body: renderEntryBody({ ...entry, bodyDoc: '' }),
                  })
                : null,
            ],
          },
        )}</div><aside class="website-post-settings website-form-field" aria-label=${tr('website.postEditor.settings')}>${h(
          Surface,
          {
            title: tr('website.postEditor.settings'),
            body: h(Stack, {
              items: [
                h(Status, entryStatus(tr, entry.state ?? 'draft')),
                input('path', tr('website.entry.path'), entry.path),
                input('author', tr('website.post.author'), entry.author),
                h(Select, {
                  id: 'post-locale',
                  name: 'locale',
                  label: tr('website.entry.locale'),
                  value: entry.locale,
                  disabled: !writable(),
                  options: ctx.site().locales.map((value) => ({ value, label: value.toUpperCase() })),
                }),
                h(Section, {
                  title: tr('website.post.category'),
                  body: h(Select, {
                    id: 'post-category',
                    name: 'category',
                    label: tr('website.post.category'),
                    value: entry.category ?? '',
                    disabled: !writable(),
                    options: [
                      { value: '', label: tr('website.post.noCategory') },
                      ...terms
                        .filter((r) => r.taxonomyType === 'category')
                        .map((r) => ({ value: r.id, label: r.title })),
                    ],
                  }),
                }),
                h(Section, {
                  title: tr('website.post.tags'),
                  body: h(CheckboxGroup, {
                    id: 'post-tags',
                    name: 'tags',
                    label: tr('website.postEditor.selectTags'),
                    disabled: !writable(),
                    optionsOrientation: 'vertical',
                    options: terms
                      .filter((r) => r.taxonomyType === 'tag')
                      .map((r) => ({
                        name: 'tags',
                        value: r.id,
                        label: r.title,
                        checked: (entry.tags ?? []).includes(r.id),
                      })),
                  }),
                }),
                h(Section, {
                  title: tr('website.post.cover'),
                  body: entry.revisionId
                    ? AttachmentImage(ctx, {
                        id: entry.id,
                        field: 'cover',
                        value: entry.cover,
                        alt: entry.coverAlt,
                        disabled: !writable(),
                        resModel: 'website.Entry',
                      })
                    : html`<input type="hidden" name="cover" value=""/><input type="hidden" name="coverAlt" value=""/>${h(Notice, { title: tr('website.post.cover'), message: tr('website.postEditor.saveForImage'), tone: 'info' })}`,
                }),
                h(Disclosure, {
                  summary: tr('website.postEditor.date'),
                  body: input('publishedAt', tr('website.postEditor.dateHelp'), entry.publishedAt),
                }),
                h(Section, {
                  title: tr('website.schedule.title'),
                  body: EntrySchedule(ctx, entry, {
                    command: `${prefix}.schedule`,
                    cancel: `${prefix}.cancelSchedule`,
                    form: 'post-editor',
                  }),
                }),
              ],
            }),
          },
        )}</aside></div></form>`,
      })
    },
    commands: {
      [`${prefix}.save`]: async (_, form) => {
        const saved = await save(form)
        ctx.notify(tr('website.resource.saved'))
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.preview`]: async (_, form) => {
        const saved = await save(form)
        await ctx.navigate('preview', { id: saved.id })
      },
      [`${prefix}.publish`]: async (_, form) => {
        const saved = await save(form)
        await publishEntry(ctx, saved)
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.schedule`]: async (_, form) => {
        const at = scheduleTime(ctx, form)
        const saved = await save(form)
        await publishEntry(ctx, saved, at)
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.cancelSchedule`]: async () => {
        await cancelSchedule(ctx, current)
        await ctx.refresh()
      },
      [`${prefix}.archive`]: async (_, form) => {
        if (!form.has('confirmed')) return
        await ctx.call('website_studio.setEntryArchived', {
          id: current.id,
          siteId: ctx.site().id,
          archived: !current.trashed,
          expectedRevisionId: current.revisionId,
        })
        await ctx.navigate('posts')
      },
    },
  }
}
