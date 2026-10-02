import { html } from '@ketvietlab/ketjs-view'
// Forms and their submissions. Submissions are personal data: reading one is audited, holding one
// stops its retention purge, and export is a server-produced CSV (the client never assembles it).
import {
  ActionGroup,
  DataTable,
  ListPage,
  Status,
  Tabs,
  LinkButton,
  CardGrid,
  ContentCard,
  DescriptionList,
  EmptyState,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { destinationStatus, formatTime, submissionStatus } from './format.mjs'

const FILTERS = ['all', 'new', 'held']

export function createFormList(ctx) {
  const tr = ctx.tr
  return {
    read: (_route, signal) => ctx.call('website_form.listForms', { siteId: ctx.site().id }, { signal }),
    view: (value) =>
      h(ListPage, {
        variant: 'operational',
        title: tr('website.route.forms'),
        headerActions: ctx.can('website.form.manage')
          ? h(LinkButton, {
              label: tr('website.formDesign.create'),
              href: ctx.href('form-editor-edit', { id: 'new' }),
              variant: 'primary',
            })
          : null,
        footer: tr('website.list.results', { count: value.rows.length }),
        body: value.rows.length
          ? h(CardGrid, {
              minimum: 'wide',
              items: value.rows,
              id: (row) => row.id,
              card: (row) =>
                h(ContentCard, {
                  title: row.title,
                  href: ctx.href(ctx.can('website.form.manage') ? 'form-editor-edit' : 'submissions', {
                    id: row.id,
                  }),
                  status: h(Status, {
                    label: tr(row.active ? 'website.form.active' : 'website.form.inactive'),
                    tone: row.active ? 'positive' : 'neutral',
                  }),
                  body: h(DescriptionList, {
                    layout: 'strip',
                    items: [
                      { id: 'new', label: tr('website.form.new'), value: String(row.newCount ?? 0) },
                      { id: 'total', label: tr('website.form.total'), value: String(row.total ?? 0) },
                    ],
                  }),
                  meta: html`<span>${tr('website.form.lastAt')}: ${formatTime(row.lastAt)}</span>`,
                  actions: h(ActionGroup, {
                    label: row.title,
                    actions: [
                      ctx.can('website.form.manage')
                        ? h(LinkButton, {
                            label: tr('website.resource.edit'),
                            href: ctx.href('form-editor-edit', { id: row.id }),
                          })
                        : null,
                      h(LinkButton, {
                        label: tr('website.formDesign.responses'),
                        href: ctx.href('submissions', { id: row.id }),
                      }),
                      row.active
                        ? h(LinkButton, {
                            label: tr('website.builder.preview'),
                            href: ctx.href('visitor-form', { id: row.id }),
                            variant: 'tertiary',
                          })
                        : null,
                    ].filter(Boolean),
                  }),
                }),
            })
          : h(EmptyState, {
              title: tr('website.form.emptyTitle'),
              message: tr('website.formDesign.emptyHelp'),
            }),
      }),
  }
}

export function createSubmissionList(ctx) {
  const tr = ctx.tr
  return {
    readKey: (route) => [route.params.id, route.query.status ?? 'all'],
    read: async (route, signal) => {
      const status = FILTERS.includes(route.query.status) ? route.query.status : 'all'
      const [form, list] = await Promise.all([
        ctx.call('website_form.getForm', { id: route.params.id }, { signal }),
        ctx.call(
          'website_form.listSubmissions',
          { formId: route.params.id, status: status === 'all' ? null : status, limit: 50, offset: 0 },
          { signal },
        ),
      ])
      return { form, rows: list.rows, total: list.total }
    },
    view: (value, route) => {
      const status = FILTERS.includes(route.query.status) ? route.query.status : 'all'
      const canManage = ctx.can('website.submission.manage')
      const busy = ctx.busy()
      return h(ListPage, {
        variant: 'operational',
        title: value.form.title,
        actions: CommandButton({
          label: tr('website.submission.export'),
          command: 'submissions.export',
          args: { form: value.form.id },
          disabled: !canManage || busy,
        }),
        actionsPlacement: 'header',
        // A form without a retention period keeps its submissions until someone removes them.
        footer: value.form.retentionDays
          ? tr('website.submission.footer', { count: value.total, days: value.form.retentionDays })
          : tr('website.submission.footerKept', { count: value.total }),
        controls: h(Tabs, {
          label: tr('website.submission.filter'),
          items: FILTERS.map((filter) => ({
            id: filter,
            label: tr(`website.submission.filter.${filter}`),
            href: ctx.href(
              'submissions',
              { id: value.form.id },
              { status: filter === 'all' ? null : filter },
            ),
            active: filter === status,
          })),
        }),
        body: h(DataTable, {
          columns: [
            {
              key: 'from',
              label: tr('website.submission.from'),
              cell: (row) => row.summary,
              priority: 'primary',
            },
            {
              key: 'message',
              label: tr('website.submission.message'),
              cell: (row) => row.excerpt,
              priority: 'secondary',
            },
            {
              key: 'state',
              label: tr('website.submission.state'),
              cell: (row) => h(Status, submissionStatus(tr, row.status)),
              kind: 'status',
            },
            {
              key: 'delivery',
              label: tr('website.formJourney.delivery'),
              cell: (row) => tr(`website.delivery.${row.deliveryState}`),
            },
            // Only forms routed to an ERP module have a hand-off to report.
            ...(value.rows.some((row) => row.destinationState)
              ? [
                  {
                    key: 'destination',
                    label: tr('website.formJourney.destinationState'),
                    cell: (row) =>
                      row.destinationState
                        ? h(
                            Status,
                            destinationStatus(
                              tr,
                              row.destinationState,
                              row.destinationOutcome,
                              row.destinationStatus,
                            ),
                          )
                        : '—',
                    kind: 'status',
                  },
                ]
              : []),
            {
              key: 'retention',
              label: tr('website.formJourney.retention'),
              cell: (row) =>
                row.status === 'held' ? tr('website.submission.filter.held') : formatTime(row.retentionUntil),
            },
            {
              key: 'at',
              label: tr('website.submission.receivedAt'),
              cell: (row) => formatTime(row.createdAt),
              kind: 'date',
            },
            {
              key: 'actions',
              label: tr('website.submission.actions'),
              cell: (row) =>
                h(ActionGroup, {
                  label: tr('website.submission.actions'),
                  actions: [
                    row.status === 'new'
                      ? CommandButton({
                          label: tr('website.submission.markRead'),
                          command: 'submission.read',
                          args: { id: row.id },
                          disabled: !canManage || busy,
                        })
                      : null,
                    row.status !== 'held'
                      ? CommandButton({
                          label: tr('website.submission.hold'),
                          command: 'submission.hold',
                          args: { id: row.id },
                          disabled: !canManage || busy,
                        })
                      : null,
                  ].filter(Boolean),
                }),
              align: 'end',
            },
          ],
          rows: value.rows,
          id: (row) => row.id,
          rowHref: (row) => ctx.href('submission-detail', { id: row.id }),
          emptyTitle: tr(`website.submission.empty.${status}`),
          emptyMessage: tr('website.submission.emptyMessage'),
        }),
      })
    },
    commands: {
      'submission.read': async ({ id }) => {
        await ctx.call('website_form.readSubmission', { id })
        await ctx.refresh()
      },
      'submission.hold': async ({ id }) => {
        await ctx.call('website_form.holdSubmission', { id, reason: 'studio' })
        ctx.notify(tr('website.submission.held'))
        await ctx.refresh()
      },
      'submissions.export': async ({ form }) => {
        const file = await ctx.call('website_form.exportSubmissions', { formId: form })
        if (!globalThis.document) return
        const link = document.createElement('a')
        link.href = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }))
        link.download = file.filename
        link.click()
        ctx.notify(tr('website.submission.exported'))
        setTimeout(() => URL.revokeObjectURL(link.href), 0)
      },
    },
  }
}
