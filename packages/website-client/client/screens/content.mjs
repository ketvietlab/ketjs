import { renderEntryBody } from '../post-document.mjs'
import { LiveDescription } from '../live-description.mjs'
import { ArchiveActions } from '../archive-actions.mjs'
import { postFields, readPostFields } from './post-fields.mjs'
import { publicFrame } from './visitor-commerce.mjs'
import { publicMetadata } from '../metadata.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  WorkspacePage,
  RecordPage,
  Surface,
  Stack,
  Grid,
  TextField,
  Select,
  LinkButton,
  DataTable,
  Notice,
} from '@ketvietlab/design-system'
import { h, CommandButton, fragments } from '../ui.mjs'
import { safeHref } from '../renderer.mjs'
import { formatTime } from './format.mjs'

export function createEntryDetails(ctx) {
  let current
  let compareRevision = null
  let terms = []
  let changes = []
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      current = await ctx.call(
        'website_studio.entryHistory',
        { id: route.params.id, siteId: ctx.site().id },
        { signal },
      )
      if (current.entry.type === 'post' && ctx.can('website.content.write'))
        terms = (
          await ctx.call(
            'website_studio.listResources',
            { siteId: ctx.site().id, kind: 'taxonomy' },
            { signal },
          )
        ).rows
      changes = ctx.can('website.content.write')
        ? ((
            await ctx.call(
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
    view: (data) =>
      h(RecordPage, {
        width: 'wide',
        title: data.entry.title,
        actions: html`${h(LinkButton, { label: ctx.tr(data.entry.type === 'post' ? 'website.postEditor.edit' : 'website.builder.canvas'), href: ctx.href(data.entry.type === 'post' ? 'post-edit' : 'builder', { id: data.entry.id }) })}${CommandButton({ label: ctx.tr('website.action.save'), command: 'content.metadata', type: 'submit', form: 'entry-metadata', variant: 'primary', disabled: ctx.busy() || !ctx.can('website.content.write') })}${ArchiveActions(ctx, { id: 'entry-archive', title: data.entry.title, command: 'content.archive', disabled: ctx.busy() || !ctx.can('website.content.write'), restore: data.entry.trashed })}`,
        body: h(Stack, {
          items: [
            h(Surface, {
              title: ctx.tr('website.resource.details'),
              body: html`<form id="entry-metadata" novalidate>${h(Grid, {
                columns: 2,
                items: [
                  h(TextField, {
                    id: 'entry-title',
                    name: 'title',
                    label: ctx.tr('website.entry.title'),
                    value: data.entry.title,
                    required: true,
                  }),
                  h(TextField, {
                    id: 'entry-path',
                    name: 'path',
                    label: ctx.tr('website.entry.path'),
                    value: data.entry.path,
                    required: true,
                  }),
                  h(Select, {
                    id: 'entry-locale',
                    name: 'locale',
                    label: ctx.tr('website.entry.locale'),
                    value: data.entry.locale,
                    options: ctx.site().locales.map((value) => ({ value, label: value.toUpperCase() })),
                  }),
                ],
              })}${data.entry.type === 'post' ? postFields(ctx, data.entry, terms) : null}</form>`,
            }),
            h(Surface, {
              title: ctx.tr('website.content.compare'),
              body: html`<form id="history-compare">${h(Select, { id: 'history-before', name: 'revision', label: ctx.tr('website.content.before'), value: compareRevision ?? data.liveRevisionId ?? data.revisions.at(-1)?.revisionId, options: data.revisions.map((r) => ({ value: r.revisionId, label: r.revisionId })) })}${CommandButton({ label: ctx.tr('website.content.compare'), command: 'content.compare', type: 'submit', form: 'history-compare' })}</form>${h(
                DataTable,
                {
                  rows: changes,
                  id: (r) => `${r.id}:${r.change}`,
                  columns: [
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
                  ],
                  emptyTitle: ctx.tr('website.content.noChanges'),
                },
              )}`,
            }),
            h(Surface, {
              title: ctx.tr('website.content.history'),
              body: h(DataTable, {
                rows: data.revisions,
                id: (row) => row.revisionId,
                columns: [
                  {
                    key: 'revision',
                    label: ctx.tr('website.resource.revision'),
                    cell: (row) => row.revisionId,
                    priority: 'primary',
                  },
                  { key: 'title', label: ctx.tr('website.entry.title'), cell: (row) => row.title },
                  { key: 'actor', label: ctx.tr('website.publication.preparedBy'), cell: (r) => r.updatedBy },
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
                      r.revisionId === data.liveRevisionId ? ctx.tr('website.entry.state.published') : '—',
                  },
                  {
                    key: 'actions',
                    label: ctx.tr('website.content.history'),
                    cell: (row) =>
                      html`${h(LinkButton, { label: ctx.tr('website.builder.preview'), href: ctx.href('preview', { id: row.id }, { revision: row.revisionId }) })}${CommandButton({ label: ctx.tr('website.content.restore'), command: 'content.restore', args: { revision: row.revisionId }, disabled: !ctx.can('website.content.write') || row.revisionId === data.entry.revisionId || ctx.busy() })}`,
                  },
                ],
              }),
            }),
          ],
        }),
      }),
    commands: {
      'content.compare': async (_, form) => {
        compareRevision = String(form.get('revision'))
        await ctx.refresh()
      },
      'content.archive': async (_, form) => {
        if (!form?.has('confirmed')) return
        await ctx.call('website_studio.setEntryArchived', {
          id: current.entry.id,
          siteId: ctx.site().id,
          archived: !current.entry.trashed,
          expectedRevisionId: current.entry.revisionId,
        })
        await ctx.navigate(current.entry.type === 'post' ? 'posts' : 'pages')
      },
      'content.metadata': async (_args, form) => {
        const entry = current.entry
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
        await ctx.call('website_studio.restoreEntry', {
          id: current.entry.id,
          siteId: ctx.site().id,
          revisionId: revision,
          expectedRevisionId: current.entry.revisionId,
        })
        ctx.notify(ctx.tr('website.resource.saved'))
        await ctx.refresh()
      },
    },
  }
}

export function createPreview(ctx) {
  let current
  return {
    readKey: (route) => [
      route.params.id,
      route.query.revision,
      route.query.token,
      route.query.device,
      route.query.profile,
    ],
    read: async (route, signal) =>
      (current = await ctx.call(
        'website_studio.preview',
        {
          id: route.params.id,
          siteId: ctx.site().id,
          revisionId: route.query.revision,
          token: route.query.token,
        },
        { signal },
      )),
    view: (data, route) =>
      h(WorkspacePage, {
        title: data.entry.title,
        actions: h(LinkButton, {
          label: ctx.tr(data.entry.type === 'post' ? 'website.postEditor.edit' : 'website.content.back'),
          href: ctx.href(data.entry.type === 'post' ? 'post-edit' : 'builder', { id: data.entry.id }),
        }),
        body: h(Stack, {
          items: [
            h(Notice, {
              title: ctx.tr('website.route.preview'),
              message: ctx.tr('website.content.previewHelp'),
              tone: 'info',
            }),
            html`<form id="website-preview-options">${h(Select, { id: 'preview-device', name: 'device', label: ctx.tr('website.preview.device'), value: route.query.device ?? 'desktop', options: ['desktop', 'tablet', 'mobile'].map((value) => ({ value, label: ctx.tr(`website.workspace.device.${value}`) })) })}${h(Select, { id: 'preview-profile', name: 'profile', label: ctx.tr('website.preview.profile'), value: route.query.profile ?? 'guest', options: ['guest', 'registered'].map((value) => ({ value, label: ctx.tr(`website.workspace.${value}`) })) })}${CommandButton({ label: ctx.tr('website.preview.apply'), command: 'preview.options', form: 'website-preview-options', type: 'submit' })}</form>`,
            data.preview
              ? h(Notice, {
                  title: ctx.tr('website.preview.link'),
                  message: `${ctx.tr(`website.preview.audience.${data.preview.audience}`)} · ${ctx.tr('website.preview.expires')}: ${formatTime(data.preview.expiresAt)}`,
                  tone: 'info',
                  // Staff open the preview here; anyone else gets the site's own address.
                  actions: fragments([
                    data.preview.url
                      ? h(LinkButton, { label: ctx.tr('website.preview.share'), href: data.preview.url })
                      : null,
                    ctx.can('website.content.write')
                      ? CommandButton({
                          label: ctx.tr('website.preview.revoke'),
                          command: 'preview.revoke',
                          args: { token: data.preview.token },
                        })
                      : null,
                  ]),
                })
              : null,
            ctx.can('website.content.write')
              ? html`<form id="website-preview-share">${h(Select, { id: 'preview-audience', name: 'audience', label: ctx.tr('website.preview.audience'), value: 'staff', options: ['staff', 'link'].map((value) => ({ value, label: ctx.tr(`website.preview.audience.${value}`) })) })}${h(TextField, { id: 'preview-minutes', name: 'minutes', label: ctx.tr('website.preview.minutes'), value: '30', type: 'number' })}${CommandButton({ label: ctx.tr('website.preview.create'), command: 'preview.create', form: 'website-preview-share', type: 'submit' })}</form>`
              : null,
            html`<div class="website-preview-device" data-device=${route.query.device ?? 'desktop'}><div class="wt-site" data-theme-preset=${data.theme?.preset ?? 'default'} data-accent=${data.theme?.accent} data-font=${data.theme?.font} data-buttons=${data.theme?.buttons} data-spacing=${data.theme?.spacing}>${renderEntryBody(
              data.entry,
              {
                locale: data.entry.locale,
                profile: route.query.profile ?? 'guest',
                viewport: route.query.device ?? 'desktop',
                preset: data.theme?.preset,
                href: (path) => (path.startsWith('/') ? ctx.href('public', {}, { path }) : safeHref(path)),
              },
            )}</div></div>`,
          ],
        }),
      }),
    commands: {
      'preview.options': (_, form) =>
        ctx.navigate(
          'preview',
          { id: current.entry.id },
          { ...ctx.route().query, device: String(form.get('device')), profile: String(form.get('profile')) },
        ),
      'preview.create': async (_, form) => {
        const r = await ctx.call('website_studio.createPreview', {
          siteId: ctx.site().id,
          id: current.entry.id,
          revisionId: current.entry.revisionId,
          audience: String(form.get('audience')),
          minutes: Number(form.get('minutes')),
        })
        await ctx.navigate('preview', { id: r.id }, { token: r.token })
      },
      'preview.revoke': async ({ token }) => {
        await ctx.call('website_studio.revokePreview', { siteId: ctx.site().id, token })
        await ctx.navigate('preview', { id: current.entry.id }, { revision: current.entry.revisionId })
      },
    },
  }
}

export function createPublicSite(ctx) {
  const destination = (path) => {
    const key = { '/shop': 'shop', '/stays': 'stays', '/blog': 'public-blog', '/account': 'visitor-account' }[
      path
    ]
    if (key) return ctx.href(key)
    if (path === '/dat-ban') return ctx.href('visitor-table')
    return path?.startsWith('/') ? ctx.href('public', {}, { path }) : safeHref(path)
  }
  return {
    readKey: (route) => [route.query.path, route.query.q, route.query.type, route.query.page],
    metadata: publicMetadata,
    read: (route, signal) =>
      ctx.call(
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
        h(Stack, {
          items: [
            html`<details class="website-public-search" open=${route.query.q || data.theme?.preset !== 'cosmetics' ? true : null}><summary hidden=${data.theme?.preset !== 'cosmetics'}>${ctx.tr('website.search.label')}</summary><form id="public-search">${h(TextField, { id: 'public-query', name: 'q', label: ctx.tr('website.search.label'), value: route.query.q ?? '' })}${h(Select, { id: 'public-type', name: 'type', label: ctx.tr('website.search.type'), value: route.query.type ?? 'all', options: ['all', 'page', 'post'].map((value) => ({ value, label: ctx.tr(`website.search.type.${value}`) })) })}${CommandButton({ label: ctx.tr('website.search.submit'), command: 'public.search', type: 'submit', form: 'public-search' })}</form></details>`,
            route.query.q
              ? html`<p>${ctx.tr('website.list.results', { count: data.total })} · ${ctx.tr(`website.search.index.${data.indexState}`)}</p>`
              : null,
            data.entry?.type === 'post' && !route.query.q
              ? html`<p>${data.entry.author || data.entry.updatedBy} · ${data.entry.publishedAt || data.entry.updatedAt}</p>${data.entry.cover ? html`<figure class="website-media-preview"><img src=${safeHref(data.entry.cover)} alt=${data.entry.coverAlt || data.entry.title} /></figure>` : null}<p>${data.entry.excerpt ?? ''}</p>`
              : null,
            data.archive?.cover
              ? html`<figure class="website-media-preview"><img src=${safeHref(data.archive.cover)} alt=${data.archive.coverAlt ?? ''} /></figure>`
              : null,
            data.archive?.thumbnail
              ? html`<img class="website-taxonomy-image-thumbnail" src=${safeHref(data.archive.thumbnail)} alt=${data.archive.thumbnailAlt ?? ''} />`
              : null,
            data.archive && (data.archive.descriptionDoc || data.archive.description)
              ? LiveDescription({
                  id: data.archive.id,
                  revision: data.publicationId,
                  value: data.archive.descriptionDoc,
                  text: data.archive.description,
                  label: ctx.tr('website.taxonomy.description'),
                  readOnly: true,
                })
              : null,
            route.query.q || data.archive
              ? h(DataTable, {
                  rows: data.rows,
                  id: (r) => r.id,
                  rowHref: (r) => ctx.href('public', {}, { path: r.path }),
                  columns: [
                    {
                      key: 'title',
                      label: ctx.tr('website.entry.title'),
                      cell: (r) => html`<strong>${r.title}</strong><p>${r.excerpt}</p>`,
                      priority: 'primary',
                    },
                  ],
                  emptyTitle: ctx.tr('website.resource.empty'),
                })
              : data.entry
                ? html`<div class="wt-site" data-theme-preset=${data.theme?.preset ?? 'default'} data-accent=${data.theme?.accent ?? 'green'} data-font=${data.theme?.font ?? 'sans'} data-spacing=${data.theme?.spacing ?? 'comfortable'} data-buttons=${data.theme?.buttons ?? 'rounded'}>${renderEntryBody(data.entry, { headingLevel: data.theme?.preset === 'cosmetics' && data.entry.layout[0]?.type === 'website.hero' ? 1 : 2, preset: data.theme?.preset, locale: data.entry.locale, profile: data.profile, href: destination })}</div>`
                : h(Notice, {
                    title: ctx.tr('website.content.notFound'),
                    message: ctx.tr('website.content.notFoundHelp'),
                    tone: 'warning',
                  }),
            route.query.q || data.archive
              ? html`<nav aria-label=${ctx.tr('website.search.pagination')}>${data.page > 1 ? h(LinkButton, { label: ctx.tr('website.search.previous'), href: ctx.href('public', {}, { ...route.query, page: String(data.page - 1) }) }) : null}<span>${data.page}/${data.pageCount}</span>${data.page < data.pageCount ? h(LinkButton, { label: ctx.tr('website.search.next'), href: ctx.href('public', {}, { ...route.query, page: String(data.page + 1) }) }) : null}</nav>`
              : null,
            data.entry?.type === 'post' && !route.query.q
              ? h(Surface, {
                  title: ctx.tr('website.post.related'),
                  body: fragments(
                    data.related.map((r) =>
                      h(LinkButton, { label: r.title, href: ctx.href('public', {}, { path: r.path }) }),
                    ),
                  ),
                })
              : null,
            fragments(
              data.forms.map((form) =>
                h(LinkButton, { label: form.title, href: ctx.href('visitor-form', { id: form.id }) }),
              ),
            ),
          ],
        }),
        {
          brand: data.site.name,
          menus: data.menus,
          theme: data.theme,
          resolveLink: destination,
          titleVisible:
            !!route.query.q ||
            data.theme?.preset !== 'cosmetics' ||
            data.entry?.layout[0]?.type !== 'website.hero',
        },
      ),
    commands: {
      'public.search': async (_, form) =>
        ctx.navigate(
          'public',
          {},
          { q: String(form.get('q') ?? '').trim(), type: String(form.get('type') ?? 'all') },
        ),
    },
  }
}
