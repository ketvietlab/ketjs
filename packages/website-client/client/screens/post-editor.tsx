import { cancelSchedule, EntrySchedule, publishEntry, scheduleTime } from './entry-publishing.tsx'
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
import { CommandButton, fragments } from '../ui.tsx'
import { LiveDescription } from '../live-description.tsx'
import { AttachmentImage } from '../image-upload.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import { postDocument, postLegacyLayout, renderEntryBody } from '../post-document.tsx'
import { readPostFields } from './post-fields.tsx'
import { entryStatus, newId } from './format.ts'
import type { Entry, Screen, StudioContext, TaxonomyTerm } from '../types.ts'

/** A post as its editor holds it: a new one has no revision until its first save. */
type PostDraft = Omit<Entry, 'revisionId'> & { revisionId?: string; siteId?: string }

export function createPostEditor(ctx: StudioContext, isNew = false) {
  const tr = ctx.tr
  const prefix = isNew ? 'postCreate' : 'postEditor'
  let current: PostDraft | null = null,
    terms: TaxonomyTerm[] = [],
    pendingId: string | null = null
  const writable = () => ctx.can('website.content.write') && !current?.trashed
  const input = (name: string, label: string, value: string | null | undefined, area = false) => {
    const props = { id: `post-${name}`, name, label, value: value ?? '', disabled: !writable() }
    return area ? <TextArea {...props} /> : <TextField {...props} />
  }
  const save = async (form: FormData) => {
    if (!writable()) throw Object.assign(new Error(tr('website.resource.validation')), { code: 'forbidden' })
    const title = String(form.get('title') ?? '').trim(),
      path = String(form.get('path') ?? '').trim()
    if (!title || !path.startsWith('/'))
      throw Object.assign(new Error(tr('website.page.invalid')), { code: 'validation' })
    // The commands that save only run once `read` loaded the post.
    const post = current!
    const result = await ctx.call<Entry>(
      'website.saveEntry',
      {
        ...post,
        ...readPostFields(form),
        id: post.id,
        siteId: ctx.site().id,
        type: 'post',
        title,
        path,
        slug: path.slice(1),
        locale: String(form.get('locale') ?? post.locale),
        bodyDoc: String(form.get('descriptionDoc') ?? ''),
        seo: {
          title: String(form.get('seoTitle') ?? ''),
          description: String(form.get('seoDescription') ?? ''),
          canonical: String(form.get('canonical') ?? ''),
          indexing: String(form.get('indexing') ?? 'index'),
          image: String(form.get('cover') ?? ''),
        },
        layout: post.layout ?? [],
        expectedRevisionId: post.revisionId ?? null,
      },
      post.revisionId ? {} : { key: post.id },
    )
    current = { ...post, revisionId: result.revisionId }
    pendingId = null
    return result
  }
  return {
    readKey: (route) => route.params.id ?? 'new',
    read: async (route, signal) => {
      const post: PostDraft = isNew
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
        : (await ctx.call<{ entry: PostDraft }>('website.getEntry', { id: route.params.id }, { signal }))
            .entry
      current = post
      if (post.type !== 'post' || (post.siteId && post.siteId !== ctx.site().id))
        throw Object.assign(new Error(tr('website.content.notFound')), { code: 'notFound' })
      terms = ctx.can('website.content.write')
        ? (
            await ctx.call<{ rows: TaxonomyTerm[] }>(
              'website_studio.listResources',
              { siteId: ctx.site().id, kind: 'taxonomy' },
              { signal },
            )
          ).rows
        : []
      return post
    },
    view: (entry) => {
      const disabled = !writable() || ctx.busy()
      const button = (key: string, command: string, variant: 'primary' | 'secondary' = 'secondary') => (
        <CommandButton
          label={tr(key)}
          command={command}
          form="post-editor"
          type="submit"
          variant={variant}
          disabled={disabled}
        />
      )
      return (
        <RecordPage
          width="wide"
          title={isNew ? tr('website.route.postNew') : entry.title}
          actions={fragments([
            <LinkButton label={tr('website.resource.back')} href={ctx.href('posts')} />,
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
          ])}
          body={
            <form id="post-editor" novalidate>
              <div class="website-post-workspace">
                <div class="website-post-content">
                  <Stack
                    items={[
                      <Surface
                        title={tr('website.postEditor.content')}
                        body={
                          <Stack
                            items={[
                              <div class="website-form-field">
                                <TextField
                                  id="post-title"
                                  name="title"
                                  label={tr('website.entry.title')}
                                  value={entry.title}
                                  required
                                  disabled={!writable()}
                                />
                              </div>,
                              <LiveDescription
                                id={`post-${entry.id}`}
                                revision={entry.revisionId}
                                value={postDocument(entry)}
                                label={tr('website.postEditor.body')}
                                readOnly={!writable()}
                                field
                                images={{
                                  ctx,
                                  ownerId: entry.id,
                                  disabled: !entry.revisionId || !writable(),
                                }}
                              />,
                            ]}
                          />
                        }
                      />,
                      <Surface
                        title={tr('website.post.excerpt')}
                        body={
                          <div class="website-form-field">
                            {input('excerpt', tr('website.postEditor.excerptHelp'), entry.excerpt, true)}
                          </div>
                        }
                      />,
                      <Surface
                        title={tr('website.route.seo')}
                        body={
                          <div class="website-form-field">
                            <Stack
                              items={[
                                input('seoTitle', tr('website.resource.seo.title'), entry.seo?.title),
                                input(
                                  'seoDescription',
                                  tr('website.resource.seo.description'),
                                  entry.seo?.description,
                                  true,
                                ),
                                input(
                                  'canonical',
                                  tr('website.resource.seo.canonical'),
                                  entry.seo?.canonical,
                                ),
                                <Select
                                  id="post-indexing"
                                  name="indexing"
                                  label={tr('website.resource.seo.indexing')}
                                  value={entry.seo?.indexing ?? 'index'}
                                  disabled={!writable()}
                                  options={[
                                    { value: 'index', label: tr('website.option.index') },
                                    { value: 'noindex', label: tr('website.option.noindex') },
                                  ]}
                                />,
                              ]}
                            />
                          </div>
                        }
                      />,
                      postLegacyLayout(entry.layout).length ? (
                        <Surface
                          title={tr('website.postEditor.legacy')}
                          description={tr('website.postEditor.legacyHelp')}
                          body={renderEntryBody({ ...entry, bodyDoc: '' })}
                        />
                      ) : null,
                    ]}
                  />
                </div>
                <aside
                  class="website-post-settings website-form-field"
                  aria-label={tr('website.postEditor.settings')}
                >
                  <Surface
                    title={tr('website.postEditor.settings')}
                    body={
                      <Stack
                        items={[
                          <Status {...entryStatus(tr, entry.state ?? 'draft')} />,
                          input('path', tr('website.entry.path'), entry.path),
                          input('author', tr('website.post.author'), entry.author),
                          <Select
                            id="post-locale"
                            name="locale"
                            label={tr('website.entry.locale')}
                            value={entry.locale}
                            disabled={!writable()}
                            options={ctx
                              .site()
                              .locales.map((value) => ({ value, label: value.toUpperCase() }))}
                          />,
                          <Section
                            title={tr('website.post.category')}
                            body={
                              <Select
                                id="post-category"
                                name="category"
                                label={tr('website.post.category')}
                                value={entry.category ?? ''}
                                disabled={!writable()}
                                options={[
                                  { value: '', label: tr('website.post.noCategory') },
                                  ...terms
                                    .filter((r) => r.taxonomyType === 'category')
                                    .map((r) => ({ value: r.id, label: r.title ?? '' })),
                                ]}
                              />
                            }
                          />,
                          <Section
                            title={tr('website.post.tags')}
                            body={
                              <CheckboxGroup
                                id="post-tags"
                                name="tags"
                                label={tr('website.postEditor.selectTags')}
                                disabled={!writable()}
                                optionsOrientation="vertical"
                                options={terms
                                  .filter((r) => r.taxonomyType === 'tag')
                                  .map((r) => ({
                                    name: 'tags',
                                    value: r.id,
                                    label: r.title ?? '',
                                    checked: (entry.tags ?? []).includes(r.id),
                                  }))}
                              />
                            }
                          />,
                          <Section
                            title={tr('website.post.cover')}
                            body={
                              entry.revisionId ? (
                                AttachmentImage(ctx, {
                                  id: entry.id,
                                  field: 'cover',
                                  value: entry.cover,
                                  alt: entry.coverAlt,
                                  disabled: !writable(),
                                  resModel: 'website.Entry',
                                })
                              ) : (
                                <>
                                  <input type="hidden" name="cover" value="" />
                                  <input type="hidden" name="coverAlt" value="" />
                                  <Notice
                                    title={tr('website.post.cover')}
                                    message={tr('website.postEditor.saveForImage')}
                                    tone="info"
                                  />
                                </>
                              )
                            }
                          />,
                          <Disclosure
                            summary={tr('website.postEditor.date')}
                            body={input('publishedAt', tr('website.postEditor.dateHelp'), entry.publishedAt)}
                          />,
                          <Section
                            title={tr('website.schedule.title')}
                            body={EntrySchedule(ctx, entry, {
                              command: `${prefix}.schedule`,
                              cancel: `${prefix}.cancelSchedule`,
                              form: 'post-editor',
                            })}
                          />,
                        ]}
                      />
                    }
                  />
                </aside>
              </div>
            </form>
          }
        />
      )
    },
    commands: {
      [`${prefix}.save`]: async (_, form) => {
        const saved = await save(form!)
        ctx.notify(tr('website.resource.saved'))
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.preview`]: async (_, form) => {
        const saved = await save(form!)
        await ctx.navigate('preview', { id: saved.id })
      },
      [`${prefix}.publish`]: async (_, form) => {
        const saved = await save(form!)
        await publishEntry(ctx, saved)
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.schedule`]: async (_, form) => {
        const at = scheduleTime(ctx, form!)
        const saved = await save(form!)
        await publishEntry(ctx, saved, at)
        if (isNew) await ctx.navigate('post-edit', { id: saved.id })
        else await ctx.refresh()
      },
      [`${prefix}.cancelSchedule`]: async () => {
        await cancelSchedule(ctx, current!)
        await ctx.refresh()
      },
      [`${prefix}.archive`]: async (_, form) => {
        if (!form!.has('confirmed')) return
        await ctx.call('website_studio.setEntryArchived', {
          id: current!.id,
          siteId: ctx.site().id,
          archived: !current!.trashed,
          expectedRevisionId: current!.revisionId,
        })
        await ctx.navigate('posts')
      },
    },
  } satisfies Screen<PostDraft>
}
