import { templateLayout } from './template-layout.mjs'
import { postFields, readPostFields } from './post-fields.mjs'
// Pages and posts share the content lifecycle and one list composition; they keep separate routes.
import { html } from '@ketvietlab/ketjs-view'
import {
  DataTable,
  FilterBar,
  Grid,
  LinkButton,
  ListPage,
  ModalSheet,
  Notice,
  SearchBar,
  Select,
  Stack,
  Status,
  Tabs,
  TextField,
} from '@ketvietlab/design-system'
import { h, icon, CommandButton } from '../ui.mjs'
import { entryStatus, formatTime, newId } from './format.mjs'

const FILTERS = ['all', 'published', 'changed', 'draft', 'trash']

/** @param {any} ctx @param {'page' | 'post'} type */
export function createEntryList(ctx, type) {
  const key = type === 'page' ? 'pages' : 'posts'
  const tr = ctx.tr
  return {
    readKey: (route) => [route.query.status ?? 'all', route.query.q ?? ''],
    read: (route, signal) =>
      ctx.call(
        'website.listEntries',
        { siteId: ctx.site().id, type, status: route.query.status ?? 'all', search: route.query.q ?? '' },
        { signal },
      ),
    view: (value, route) => {
      const status = FILTERS.includes(route.query.status) ? route.query.status : 'all'
      const canWrite = ctx.can('website.content.write')
      const q = route.query.q ?? ''
      return h(ListPage, {
        variant: 'operational',
        title: tr(`website.route.${key}`),
        headerActions: canWrite
          ? h(LinkButton, {
              label: tr(`website.${type}.create`),
              href: ctx.href(type === 'page' ? 'page-new' : 'post-new'),
              variant: 'primary',
              leading: icon('plus'),
            })
          : null,
        controls: h(Stack, {
          items: [
            h(Tabs, {
              label: tr('website.entry.filter'),
              items: FILTERS.map((filter) => ({
                id: filter,
                label: tr(`website.entry.filter.${filter}`),
                href: ctx.href(key, {}, { status: filter === 'all' ? null : filter, q }),
                active: filter === status,
              })),
            }),
            h(FilterBar, {
              label: tr(`website.${type}.search`),
              filters: [
                h(SearchBar, {
                  id: `website-${key}-search`,
                  action: ctx.href(key),
                  value: q,
                  label: tr(`website.${type}.search`),
                  placeholder: tr('website.search.placeholder'),
                  submitLabel: tr('website.search.submit'),
                  hidden: status === 'all' ? undefined : { status },
                }),
              ],
            }),
          ],
        }),
        footer: tr('website.list.results', { count: value.rows.length }),
        body: h(DataTable, {
          columns: [
            { key: 'title', label: tr('website.entry.title'), cell: (row) => row.title, priority: 'primary' },
            ...(type === 'post'
              ? ['author', 'category', 'publishedAt'].map((key) => ({
                  key,
                  label: tr(`website.post.${key}`),
                  cell: (r) => r[key] || '—',
                }))
              : []),
            { key: 'path', label: tr('website.entry.path'), cell: (row) => row.path, kind: 'identifier' },
            {
              key: 'locale',
              label: tr('website.entry.locale'),
              cell: (row) => row.locale.toUpperCase(),
              width: 'narrow',
            },
            {
              key: 'state',
              label: tr('website.entry.state'),
              cell: (row) => h(Status, entryStatus(tr, row.state)),
              kind: 'status',
            },
            {
              key: 'updated',
              label: tr('website.entry.updated'),
              cell: (row) =>
                tr('website.entry.updatedBy', { time: formatTime(row.updatedAt), name: row.updatedBy }),
              priority: 'secondary',
            },
          ],
          rows: value.rows,
          id: (row) => row.id,
          rowHref: (row) =>
            ctx.href(type === 'post' ? 'post-edit' : row.state === 'trash' ? 'entry-details' : 'builder', {
              id: row.id,
            }),
          emptyTitle: tr(`website.${type}.emptyTitle`),
          emptyMessage: tr(`website.${type}.emptyMessage`),
          emptyActions: canWrite
            ? h(LinkButton, {
                label: tr(`website.${type}.create`),
                href: ctx.href(type === 'page' ? 'page-new' : 'post-new'),
                variant: 'primary',
              })
            : null,
        }),
      })
    },
  }
}

/** Route-owned modal over the page list. The id is minted here: retrying the same form is one page. */
export function createPageNew(ctx, type = 'page') {
  const tr = ctx.tr
  let requestId = null
  let terms = []
  let templates = []
  return {
    read: async () => {
      if (type === 'page' && ctx.can('website.content.write'))
        templates = (
          await ctx.call('website_studio.listResources', {
            siteId: ctx.site().id,
            kind: 'templates',
            search: '',
          })
        ).rows
      if (type === 'post' && ctx.can('website.content.write'))
        terms = (await ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'taxonomy' }))
          .rows
      return {}
    },
    view: () => {
      requestId ??= newId(type)
      const site = ctx.site()
      return h(ModalSheet, {
        id: 'website-page-new',
        title: tr(type === 'page' ? 'website.route.pageNew' : 'website.route.postNew'),
        description: tr(`website.${type}.newDescription`),
        closeHref: ctx.href(type === 'page' ? 'pages' : 'posts'),
        closeLabel: tr('website.action.close'),
        // URL-owned: close controls are links, which the studio routes client-side.
        mode: 'overlay',
        presentation: 'dialog',
        body: html`<form id="website-page-new-form" novalidate>
          <input type="hidden" name="id" value=${requestId} />
          ${
            !ctx.can('website.content.write')
              ? h(Notice, {
                  title: tr('website.readonly.title'),
                  message: tr('website.readonly.message'),
                  tone: 'warning',
                })
              : null
          }
          ${h(Grid, {
            columns: 2,
            items: [
              h(TextField, {
                id: 'page-title',
                name: 'title',
                label: tr('website.entry.title'),
                required: true,
                span: 'full',
              }),
              h(TextField, {
                id: 'page-path',
                name: 'path',
                label: tr('website.entry.path'),
                placeholder: '/gioi-thieu',
                help: tr('website.page.pathHelp'),
                required: true,
              }),
              h(Select, {
                id: 'page-locale',
                name: 'locale',
                label: tr('website.entry.locale'),
                value: site.defaultLocale,
                options: site.locales.map((locale) => ({
                  value: locale,
                  label: tr(`website.locale.${locale}`),
                })),
              }),
            ],
          })}
          ${
            type === 'page'
              ? h(Select, {
                  id: 'page-template',
                  name: 'template',
                  label: tr('website.page.startFrom'),
                  value: '',
                  options: [
                    { value: '', label: tr('website.page.blank') },
                    ...templates.map((template) => ({
                      value: template.id,
                      label: tr('website.page.templateOption', { title: template.title }),
                    })),
                  ],
                })
              : postFields(ctx, {}, terms)
          }
        </form>`,
        actions: html`${h(LinkButton, { label: tr('website.action.cancel'), href: ctx.href(type === 'page' ? 'pages' : 'posts') })}${CommandButton(
          {
            label: tr(`website.${type}.createAndEdit`),
            command: `${type}.create`,
            type: 'submit',
            form: 'website-page-new-form',
            variant: 'primary',
            disabled: !ctx.can('website.content.write') || ctx.busy(),
          },
        )}`,
      })
    },
    commands: {
      [`${type}.create`]: async (_args, form) => {
        const title = String(form.get('title') ?? '').trim()
        const path = String(form.get('path') ?? '').trim()
        if (!title || !path.startsWith('/'))
          throw Object.assign(new Error(tr('website.page.invalid')), { code: 'validation' })
        const templateId = type === 'page' ? String(form.get('template') ?? '') : ''
        const template = templates.find((item) => item.id === templateId)
        if (templateId && !template)
          throw Object.assign(new Error(tr('website.page.templateUnavailable')), { code: 'validation' })
        const saved = await ctx.call(
          'website.saveEntry',
          {
            id: String(form.get('id')),
            siteId: ctx.site().id,
            type,
            ...(type === 'post' ? readPostFields(form) : {}),
            slug: path.replace(/^\/+/, '') || 'index',
            path,
            title,
            locale: String(form.get('locale')),
            layout: template ? templateLayout(template) : [],
            expectedRevisionId: null,
          },
          { key: String(form.get('id')) },
        )
        requestId = null
        ctx.notify(tr(`website.${type}.created`))
        await ctx.navigate(type === 'post' ? 'post-edit' : 'builder', { id: saved.id }, {})
      },
    },
  }
}
