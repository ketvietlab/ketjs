import { renderEntryBody } from '../post-document.tsx'
import { LiveDescription } from '../live-description.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import { postFields, readPostFields } from './post-fields.tsx'
import { publicFrame } from './visitor-commerce.tsx'
import { publicMetadata } from '../metadata.ts'
import {
  WorkspacePage,
  RecordPage,
  Surface,
  Stack,
  Grid,
  Field,
  TextField,
  Select,
  LinkButton,
  DataTable,
  Notice,
} from '@ketvietlab/design-system'
import { CommandButton, fragments } from '../ui.tsx'
import { safeHref } from '../renderer.tsx'
import { formatTime } from './format.ts'
import type { PublicPageData } from '../metadata.ts'
import type { PublicMenu } from './visitor-commerce.tsx'
import type { Entry, Screen, SiteTheme, StudioContext, TaxonomyTerm, Viewport } from '../types.ts'
import type { EntryHistory, RevisionChange } from './builder-types.ts'
import { skinnedPreset } from '../theme/presets.ts'

/** `website_studio.preview`: one revision of a page, the site's look, and the share link if any. */
type PreviewData = {
  entry: Entry
  theme?: SiteTheme | null
  preview?: { audience: string; expiresAt: string; url?: string | null; token: string } | null
}
/** A category or tag page: its own images and description above the posts it holds. */
type PublicArchive = {
  id: string
  title: string
  path?: string
  cover?: string
  coverAlt?: string
  thumbnail?: string
  thumbnailAlt?: string
  descriptionDoc?: string
  description?: string
}
type PublicRow = { id: string; title: string; excerpt?: string; path: string }
/** `website_studio.publicSite`: what one visitor address shows. */
type PublicSite = PublicPageData & {
  entry?: Entry | null
  archive?: PublicArchive | null
  theme?: SiteTheme | null
  menus?: PublicMenu[] | null
  profile?: string
  publicationId?: string
  total: number
  indexState: string
  rows: PublicRow[]
  page: number
  pageCount: number
  related: { title: string; path: string }[]
  forms: { id: string; title: string }[]
}

export function createEntryDetails(ctx: StudioContext) {
  let current: EntryHistory | undefined
  let compareRevision: string | null = null
  let terms: TaxonomyTerm[] = []
  let changes: RevisionChange[] = []
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      current = await ctx.call<EntryHistory>(
        'website_studio.entryHistory',
        { id: route.params.id, siteId: ctx.site().id },
        { signal },
      )
      if (current.entry.type === 'post' && ctx.can('website.content.write'))
        terms = (
          await ctx.call<{ rows: TaxonomyTerm[] }>(
            'website_studio.listResources',
            { siteId: ctx.site().id, kind: 'taxonomy' },
            { signal },
          )
        ).rows
      changes = ctx.can('website.content.write')
        ? ((
            await ctx.call<{ changes?: RevisionChange[] }>(
              'website.diffRevisions',
              {
                entryId: current.entry.id,
                fromRevisionId:
                  compareRevision ?? current.liveRevisionId ?? current.revisions.at(-1)?.revisionId,
                toRevisionId: current.entry.revisionId,
              },
              { signal },
            )
          ).changes ?? [])
        : []
      return current
    },
    view: (data) => (
      <RecordPage
        width="wide"
        title={data.entry.title}
        actions={
          <>
            <LinkButton
              label={ctx.tr(
                data.entry.type === 'post' ? 'website.postEditor.edit' : 'website.builder.canvas',
              )}
              href={ctx.href(data.entry.type === 'post' ? 'post-edit' : 'builder', { id: data.entry.id })}
            />
            <CommandButton
              label={ctx.tr('website.action.save')}
              command="content.metadata"
              type="submit"
              form="entry-metadata"
              variant="primary"
              disabled={ctx.busy() || !ctx.can('website.content.write')}
            />
            {ArchiveActions(ctx, {
              id: 'entry-archive',
              title: data.entry.title,
              command: 'content.archive',
              disabled: ctx.busy() || !ctx.can('website.content.write'),
              restore: data.entry.trashed,
            })}
          </>
        }
        body={
          <Stack
            items={[
              <Surface
                title={ctx.tr('website.resource.details')}
                body={
                  <form id="entry-metadata" novalidate>
                    <Grid
                      columns={2}
                      items={[
                        <TextField
                          id="entry-title"
                          name="title"
                          label={ctx.tr('website.entry.title')}
                          value={data.entry.title}
                          required
                        />,
                        <TextField
                          id="entry-path"
                          name="path"
                          label={ctx.tr('website.entry.path')}
                          value={data.entry.path}
                          required
                        />,
                        <Select
                          id="entry-locale"
                          name="locale"
                          label={ctx.tr('website.entry.locale')}
                          value={data.entry.locale}
                          options={ctx.site().locales.map((value) => ({ value, label: value.toUpperCase() }))}
                        />,
                      ]}
                    />
                    {data.entry.type === 'post' ? postFields(ctx, data.entry, terms) : null}
                  </form>
                }
              />,
              <Surface
                title={ctx.tr('website.content.compare')}
                body={
                  <>
                    <form id="history-compare">
                      <Select
                        id="history-before"
                        name="revision"
                        label={ctx.tr('website.content.before')}
                        value={compareRevision ?? data.liveRevisionId ?? data.revisions.at(-1)?.revisionId}
                        options={data.revisions.map((r) => ({ value: r.revisionId, label: r.revisionId }))}
                      />
                      <CommandButton
                        label={ctx.tr('website.content.compare')}
                        command="content.compare"
                        type="submit"
                        form="history-compare"
                      />
                    </form>
                    <DataTable
                      rows={changes}
                      id={(r) => `${r.id}:${r.change}`}
                      columns={[
                        { key: 'id', label: ctx.tr('website.workspace.block'), cell: (r) => r.id },
                        {
                          key: 'change',
                          label: ctx.tr('website.workspace.change'),
                          cell: (r) => ctx.tr(`website.change.${r.change}`),
                        },
                        {
                          key: 'fields',
                          label: ctx.tr('website.content.changedField'),
                          cell: (r) => r.fields?.join(', ') ?? r.path,
                        },
                      ]}
                      emptyTitle={ctx.tr('website.content.noChanges')}
                      emptyMessage={ctx.tr('website.content.noChangesHelp')}
                    />
                  </>
                }
              />,
              <Surface
                title={ctx.tr('website.content.history')}
                body={
                  <DataTable
                    rows={data.revisions}
                    id={(row) => row.revisionId}
                    columns={[
                      {
                        key: 'revision',
                        label: ctx.tr('website.resource.revision'),
                        cell: (row) => row.revisionId,
                        priority: 'primary',
                      },
                      { key: 'title', label: ctx.tr('website.entry.title'), cell: (row) => row.title },
                      {
                        key: 'actor',
                        label: ctx.tr('website.publication.preparedBy'),
                        cell: (r) => r.updatedBy,
                      },
                      { key: 'time', label: ctx.tr('website.entry.updated'), cell: (r) => r.updatedAt },
                      {
                        key: 'hash',
                        label: ctx.tr('website.content.digest'),
                        cell: (r) => r.digest?.slice(0, 12) ?? '—',
                      },
                      {
                        key: 'live',
                        label: ctx.tr('website.workspace.liveRevision'),
                        cell: (r) =>
                          r.revisionId === data.liveRevisionId
                            ? ctx.tr('website.entry.state.published')
                            : '—',
                      },
                      {
                        key: 'actions',
                        label: ctx.tr('website.content.history'),
                        cell: (row) => (
                          <>
                            <LinkButton
                              label={ctx.tr('website.builder.preview')}
                              href={ctx.href('preview', { id: row.id }, { revision: row.revisionId })}
                            />
                            <CommandButton
                              label={ctx.tr('website.content.restore')}
                              command="content.restore"
                              args={{ revision: row.revisionId }}
                              disabled={
                                !ctx.can('website.content.write') ||
                                row.revisionId === data.entry.revisionId ||
                                ctx.busy()
                              }
                            />
                          </>
                        ),
                      },
                    ]}
                  />
                }
              />,
            ]}
          />
        }
      />
    ),
    commands: {
      'content.compare': async (_, form) => {
        compareRevision = String(form!.get('revision'))
        await ctx.refresh()
      },
      'content.archive': async (_, form) => {
        if (!form?.has('confirmed')) return
        const { entry } = current!
        await ctx.call('website_studio.setEntryArchived', {
          id: entry.id,
          siteId: ctx.site().id,
          archived: !entry.trashed,
          expectedRevisionId: entry.revisionId,
        })
        await ctx.navigate(entry.type === 'post' ? 'posts' : 'pages')
      },
      'content.metadata': async (_args, form) => {
        form = form!
        const entry = current!.entry
        const title = String(form.get('title') ?? '').trim()
        const path = String(form.get('path') ?? '').trim()
        if (!title || !path.startsWith('/'))
          throw Object.assign(new Error(ctx.tr('website.page.invalid')), { code: 'validation' })
        await ctx.call('website.saveEntry', {
          ...entry,
          ...(entry.type === 'post' ? readPostFields(form) : {}),
          title,
          path,
          slug: path.slice(1) || 'index',
          locale: String(form.get('locale')),
          expectedRevisionId: entry.revisionId,
        })
        ctx.notify(ctx.tr('website.resource.saved'))
        await ctx.refresh()
      },
      'content.restore': async ({ revision }) => {
        const { entry } = current!
        await ctx.call('website_studio.restoreEntry', {
          id: entry.id,
          siteId: ctx.site().id,
          revisionId: revision,
          expectedRevisionId: entry.revisionId,
        })
        ctx.notify(ctx.tr('website.resource.saved'))
        await ctx.refresh()
      },
    },
  } satisfies Screen<EntryHistory>
}

export function createPreview(ctx: StudioContext) {
  let current: PreviewData | undefined
  return {
    readKey: (route) => [
      route.params.id,
      route.query.revision,
      route.query.token,
      route.query.device,
      route.query.profile,
    ],
    read: async (route, signal) =>
      (current = await ctx.call<PreviewData>(
        'website_studio.preview',
        {
          id: route.params.id,
          siteId: ctx.site().id,
          revisionId: route.query.revision,
          token: route.query.token,
        },
        { signal },
      )),
    view: (data, route) => (
      <WorkspacePage
        title={data.entry.title}
        actions={
          <LinkButton
            label={ctx.tr(data.entry.type === 'post' ? 'website.postEditor.edit' : 'website.content.back')}
            href={ctx.href(data.entry.type === 'post' ? 'post-edit' : 'builder', { id: data.entry.id })}
          />
        }
        body={
          <Stack
            items={[
              <Notice
                title={ctx.tr('website.route.preview')}
                message={ctx.tr('website.content.previewHelp')}
                tone="info"
              />,
              <form id="website-preview-options">
                <Select
                  id="preview-device"
                  name="device"
                  label={ctx.tr('website.preview.device')}
                  value={route.query.device ?? 'desktop'}
                  options={['desktop', 'tablet', 'mobile'].map((value) => ({
                    value,
                    label: ctx.tr(`website.workspace.device.${value}`),
                  }))}
                />
                <Select
                  id="preview-profile"
                  name="profile"
                  label={ctx.tr('website.preview.profile')}
                  value={route.query.profile ?? 'guest'}
                  options={['guest', 'registered'].map((value) => ({
                    value,
                    label: ctx.tr(`website.workspace.${value}`),
                  }))}
                />
                <CommandButton
                  label={ctx.tr('website.preview.apply')}
                  command="preview.options"
                  form="website-preview-options"
                  type="submit"
                />
              </form>,
              data.preview ? (
                <Notice
                  title={ctx.tr('website.preview.link')}
                  message={`${ctx.tr(`website.preview.audience.${data.preview.audience}`)} · ${ctx.tr('website.preview.expires')}: ${formatTime(data.preview.expiresAt)}`}
                  tone="info"
                  // Staff open the preview here; anyone else gets the site's own address.
                  actions={fragments([
                    data.preview.url ? (
                      <LinkButton label={ctx.tr('website.preview.share')} href={data.preview.url} />
                    ) : null,
                    ctx.can('website.content.write') ? (
                      <CommandButton
                        label={ctx.tr('website.preview.revoke')}
                        command="preview.revoke"
                        args={{ token: data.preview.token }}
                      />
                    ) : null,
                  ])}
                />
              ) : null,
              ctx.can('website.content.write') ? (
                <form id="website-preview-share">
                  <Select
                    id="preview-audience"
                    name="audience"
                    label={ctx.tr('website.preview.audience')}
                    value="staff"
                    options={['staff', 'link'].map((value) => ({
                      value,
                      label: ctx.tr(`website.preview.audience.${value}`),
                    }))}
                  />
                  <Field
                    id="preview-minutes"
                    name="minutes"
                    label={ctx.tr('website.preview.minutes')}
                    value="30"
                    type="number"
                  />
                  <CommandButton
                    label={ctx.tr('website.preview.create')}
                    command="preview.create"
                    form="website-preview-share"
                    type="submit"
                  />
                </form>
              ) : null,
              <div class="website-preview-device" data-device={route.query.device ?? 'desktop'}>
                <div
                  class="wt-site"
                  data-theme-preset={data.theme?.preset ?? 'default'}
                  data-accent={data.theme?.accent}
                  data-font={data.theme?.font}
                  data-buttons={data.theme?.buttons}
                  data-spacing={data.theme?.spacing}
                >
                  {renderEntryBody(data.entry, {
                    locale: data.entry.locale,
                    profile: route.query.profile ?? 'guest',
                    viewport: (route.query.device ?? 'desktop') as Viewport,
                    preset: data.theme?.preset,
                    href: (path) =>
                      path.startsWith('/') ? ctx.href('public', {}, { path }) : safeHref(path),
                  })}
                </div>
              </div>,
            ]}
          />
        }
      />
    ),
    commands: {
      'preview.options': (_, form) =>
        ctx.navigate(
          'preview',
          { id: current!.entry.id },
          {
            ...ctx.route().query,
            device: String(form!.get('device')),
            profile: String(form!.get('profile')),
          },
        ),
      'preview.create': async (_, form) => {
        const r = await ctx.call<{ id: string; token: string }>('website_studio.createPreview', {
          siteId: ctx.site().id,
          id: current!.entry.id,
          revisionId: current!.entry.revisionId,
          audience: String(form!.get('audience')),
          minutes: Number(form!.get('minutes')),
        })
        await ctx.navigate('preview', { id: r.id }, { token: r.token })
      },
      'preview.revoke': async ({ token }) => {
        await ctx.call('website_studio.revokePreview', { siteId: ctx.site().id, token })
        await ctx.navigate('preview', { id: current!.entry.id }, { revision: current!.entry.revisionId })
      },
    },
  } satisfies Screen<PreviewData>
}

export function createPublicSite(ctx: StudioContext) {
  const destination = (path: string) => {
    const key = (
      { '/shop': 'shop', '/stays': 'stays', '/blog': 'public-blog', '/account': 'visitor-account' } as Record<
        string,
        string
      >
    )[path]
    if (key) return ctx.href(key)
    if (path === '/dat-ban') return ctx.href('visitor-table')
    return path?.startsWith('/') ? ctx.href('public', {}, { path }) : safeHref(path)
  }
  return {
    readKey: (route) => [route.query.path, route.query.q, route.query.type, route.query.page],
    metadata: publicMetadata,
    read: (route, signal) =>
      ctx.call<PublicSite>(
        'website_studio.publicSite',
        {
          siteId: ctx.site().id,
          path: route.query.path ?? '/',
          search: route.query.q ?? '',
          type: route.query.type ?? 'all',
          page: route.query.page ?? 1,
        },
        { signal },
      ),
    view: (data, route) =>
      publicFrame(
        ctx,
        route.query.q
          ? ctx.tr('website.search.label')
          : (data.entry?.title ?? data.archive?.title ?? data.site.name),
        <Stack
          items={[
            <details
              class="website-public-search"
              open={route.query.q || !skinnedPreset(data.theme?.preset) ? true : null}
            >
              <summary hidden={!skinnedPreset(data.theme?.preset)}>{ctx.tr('website.search.label')}</summary>
              <form id="public-search">
                <TextField
                  id="public-query"
                  name="q"
                  label={ctx.tr('website.search.label')}
                  value={route.query.q ?? ''}
                />
                <Select
                  id="public-type"
                  name="type"
                  label={ctx.tr('website.search.type')}
                  value={route.query.type ?? 'all'}
                  options={['all', 'page', 'post'].map((value) => ({
                    value,
                    label: ctx.tr(`website.search.type.${value}`),
                  }))}
                />
                <CommandButton
                  label={ctx.tr('website.search.submit')}
                  command="public.search"
                  type="submit"
                  form="public-search"
                />
              </form>
            </details>,
            route.query.q ? (
              <p>
                {ctx.tr('website.list.results', { count: data.total })} ·{' '}
                {ctx.tr(`website.search.index.${data.indexState}`)}
              </p>
            ) : null,
            data.entry?.type === 'post' && !route.query.q ? (
              <>
                <p>
                  {data.entry.author || data.entry.updatedBy} ·{' '}
                  {data.entry.publishedAt || data.entry.updatedAt}
                </p>
                {data.entry.cover ? (
                  <figure class="website-media-preview">
                    <img src={safeHref(data.entry.cover)} alt={data.entry.coverAlt || data.entry.title} />
                  </figure>
                ) : null}
                <p>{data.entry.excerpt ?? ''}</p>
              </>
            ) : null,
            data.archive?.cover ? (
              <figure class="website-media-preview">
                <img src={safeHref(data.archive.cover)} alt={data.archive.coverAlt ?? ''} />
              </figure>
            ) : null,
            data.archive?.thumbnail ? (
              <img
                class="website-taxonomy-image-thumbnail"
                src={safeHref(data.archive.thumbnail)}
                alt={data.archive.thumbnailAlt ?? ''}
              />
            ) : null,
            data.archive && (data.archive.descriptionDoc || data.archive.description) ? (
              <LiveDescription
                id={data.archive.id}
                revision={data.publicationId}
                value={data.archive.descriptionDoc}
                text={data.archive.description}
                label={ctx.tr('website.taxonomy.description')}
                readOnly
              />
            ) : null,
            route.query.q || data.archive ? (
              <DataTable
                rows={data.rows}
                id={(r) => r.id}
                rowHref={(r) => ctx.href('public', {}, { path: r.path })}
                columns={[
                  {
                    key: 'title',
                    label: ctx.tr('website.entry.title'),
                    cell: (r) => (
                      <>
                        <strong>{r.title}</strong>
                        <p>{r.excerpt}</p>
                      </>
                    ),
                    priority: 'primary',
                  },
                ]}
                emptyTitle={ctx.tr('website.visitor.empty')}
                emptyMessage={ctx.tr('website.visitor.emptyHelp')}
              />
            ) : data.entry ? (
              <div
                class="wt-site"
                data-theme-preset={data.theme?.preset ?? 'default'}
                data-accent={data.theme?.accent ?? 'green'}
                data-font={data.theme?.font ?? 'sans'}
                data-spacing={data.theme?.spacing ?? 'comfortable'}
                data-buttons={data.theme?.buttons ?? 'rounded'}
              >
                {renderEntryBody(data.entry, {
                  headingLevel:
                    skinnedPreset(data.theme?.preset) && data.entry.layout[0]?.type === 'website.hero'
                      ? 1
                      : 2,
                  preset: data.theme?.preset,
                  locale: data.entry.locale,
                  profile: data.profile,
                  href: destination,
                })}
              </div>
            ) : (
              <Notice
                title={ctx.tr('website.content.notFound')}
                message={ctx.tr('website.content.notFoundHelp')}
                tone="warning"
              />
            ),
            route.query.q || data.archive ? (
              <nav aria-label={ctx.tr('website.search.pagination')}>
                {data.page > 1 ? (
                  <LinkButton
                    label={ctx.tr('website.search.previous')}
                    href={ctx.href('public', {}, { ...route.query, page: String(data.page - 1) })}
                  />
                ) : null}
                <span>
                  {data.page}/{data.pageCount}
                </span>
                {data.page < data.pageCount ? (
                  <LinkButton
                    label={ctx.tr('website.search.next')}
                    href={ctx.href('public', {}, { ...route.query, page: String(data.page + 1) })}
                  />
                ) : null}
              </nav>
            ) : null,
            data.entry?.type === 'post' && !route.query.q ? (
              <Surface
                title={ctx.tr('website.post.related')}
                body={fragments(
                  data.related.map((r) => (
                    <LinkButton label={r.title} href={ctx.href('public', {}, { path: r.path })} />
                  )),
                )}
              />
            ) : null,
            fragments(
              data.forms.map((form) => (
                <LinkButton label={form.title} href={ctx.href('visitor-form', { id: form.id })} />
              )),
            ),
          ]}
        />,
        {
          brand: data.site.name,
          menus: data.menus,
          theme: data.theme,
          resolveLink: destination,
          titleVisible:
            !!route.query.q ||
            !skinnedPreset(data.theme?.preset) ||
            data.entry?.layout[0]?.type !== 'website.hero',
        },
      ),
    commands: {
      'public.search': async (_, form) =>
        ctx.navigate(
          'public',
          {},
          { q: String(form!.get('q') ?? '').trim(), type: String(form!.get('type') ?? 'all') },
        ),
    },
  } satisfies Screen<PublicSite>
}
