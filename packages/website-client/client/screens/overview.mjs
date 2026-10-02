// Site overview: what is live, what is waiting, what came in. Composed with `WorkspacePage
// layout="flow"` (the DS overview recipe). Rows: metrics, the live strip at full width, the two
// lists side by side, then one full-width row per `overviewCard` from extensions, so no row is left
// half empty. The lists sit two to a row, so they use ResourceList: DataTable needs 38rem and would scroll.
import { html } from '@ketvietlab/ketjs-view'
import {
  DescriptionList,
  EmptyState,
  Grid,
  LinkButton,
  Metric,
  Notice,
  ResourceList,
  Stack,
  Status,
  Surface,
  WorkspacePage,
} from '@ketvietlab/design-system'
import { h, icon } from '../ui.mjs'
import { entryStatus, formatTime, publicationStatus } from './format.mjs'

export function createOverview(ctx) {
  const muted = (text) => html`<span class="website-overview-meta">${text}</span>`
  const tr = ctx.tr
  return {
    read: (_route, signal) => ctx.call('website_studio.overview', { siteId: ctx.site().id }, { signal }),
    view: (value) => {
      const site = ctx.site()
      const { counts, live, queue, submissions } = value
      const cards = ctx.slot('overviewCard', value)
      return h(WorkspacePage, {
        title: site.name,
        layout: 'flow',
        actions: h(LinkButton, {
          label: tr('website.overview.openSite'),
          href: ctx.href('public'),
          variant: 'secondary',
        }),
        body: h(Stack, {
          items: [
            ...(value.blockers ?? []).map((r) =>
              h(Notice, {
                title: r.title,
                message: tr(`website.overview.blocker.${r.kind}`),
                tone: 'warning',
                actions: ctx.can('website.site.manage')
                  ? h(LinkButton, {
                      label: tr('website.site.resolve'),
                      href: ctx.href(
                        r.kind === 'domain' ? 'domains' : 'submission-detail',
                        r.kind === 'domain' ? {} : { id: r.id },
                      ),
                    })
                  : null,
              }),
            ),
            h(Grid, {
              columns: 4,
              items: [
                h(Metric, {
                  label: tr('website.overview.metric.pages'),
                  value: counts.pages,
                  icon: icon('file-text'),
                  href: ctx.href('pages'),
                }),
                h(Metric, {
                  label: tr('website.overview.metric.changed'),
                  value: counts.changed,
                  tone: counts.changed ? 'warning' : 'neutral',
                  icon: icon('pencil'),
                  href: ctx.href('pages', {}, { status: 'changed' }),
                }),
                h(Metric, {
                  label: tr('website.overview.metric.submissions'),
                  value: counts.newSubmissions,
                  tone: counts.newSubmissions ? 'info' : 'neutral',
                  icon: icon('mail'),
                  href: ctx.href('forms'),
                }),
                h(Metric, {
                  label: tr('website.overview.metric.health'),
                  value: counts.issues,
                  detail: counts.issues
                    ? tr('website.overview.health.issues', { count: counts.issues })
                    : tr('website.overview.health.ok'),
                  tone: counts.issues ? 'danger' : 'positive',
                  icon: icon(counts.issues ? 'alert-triangle' : 'check-circle'),
                }),
              ],
            }),
            h(Surface, {
              title: tr('website.overview.live'),
              actions: h(LinkButton, {
                label: tr('website.entry.state.published'),
                href: ctx.href('pages', {}, { status: 'published' }),
                variant: 'tertiary',
              }),
              body: live
                ? h(DescriptionList, {
                    layout: 'strip',
                    items: [
                      {
                        id: 'state',
                        label: tr('website.publication.state'),
                        value: h(Status, publicationStatus(tr, live.state)),
                      },
                      {
                        id: 'at',
                        label: tr('website.publication.activatedAt'),
                        value: formatTime(live.activatedAt),
                      },
                      { id: 'by', label: tr('website.publication.activatedBy'), value: live.activatedBy },
                      {
                        id: 'entries',
                        label: tr('website.publication.entryCount'),
                        value: String(live.entryCount),
                      },
                    ],
                  })
                : h(EmptyState, {
                    title: tr('website.overview.notLive'),
                    message: tr('website.overview.notLiveMessage'),
                  }),
            }),
            h(Grid, {
              columns: 2,
              align: 'stretch',
              items: [
                h(Surface, {
                  title: tr('website.overview.queue'),
                  body: h(ResourceList, {
                    label: tr('website.overview.queue'),
                    rows: queue,
                    id: (row) => row.id,
                    href: (row) =>
                      row.type === 'page'
                        ? ctx.href('builder', { id: row.id })
                        : ctx.href('post-edit', { id: row.id }),
                    primary: (row) => html`<span class="website-overview-name">${row.title}</span>`,
                    secondary: (row) => muted(formatTime(row.updatedAt)),
                    meta: (row) => h(Status, entryStatus(tr, row.state)),
                    emptyTitle: tr('website.overview.queueEmpty'),
                    emptyMessage: tr('website.overview.queueEmptyMessage'),
                  }),
                }),
                h(Surface, {
                  title: tr('website.overview.submissions'),
                  body: h(ResourceList, {
                    label: tr('website.overview.submissions'),
                    rows: submissions,
                    id: (row) => row.id,
                    href: (row) => ctx.href('submissions', { id: row.formId }),
                    primary: (row) =>
                      html`<span class="website-overview-name">${row.summary.split(' · ')[0]}</span>`,
                    secondary: (row) =>
                      muted([row.formTitle, ...row.summary.split(' · ').slice(1)].join(' · ')),
                    meta: (row) => muted(formatTime(row.createdAt)),
                    emptyTitle: tr('website.overview.submissionsEmpty'),
                    emptyMessage: tr('website.overview.submissionsEmptyMessage'),
                  }),
                }),
              ],
            }),
            ...cards,
          ],
        }),
      })
    },
  }
}
