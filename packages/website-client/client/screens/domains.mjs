import { html } from '@ketvietlab/ketjs-view'
import {
  ListPage,
  RecordPage,
  DataTable,
  DescriptionList,
  Surface,
  Stack,
  Notice,
  TextField,
  Checkbox,
  LinkButton,
  Status,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { newId } from './format.mjs'
const tones = { verified: 'positive', pending: 'warning', failed: 'danger' }
export function domainList(ctx, data) {
  const tr = ctx.tr
  const state = (row) => h(Status, { label: tr(`website.domain.state.${row.state}`), tone: tones[row.state] })
  const columns = [
    {
      key: 'title',
      label: tr('website.resource.domains.title'),
      cell: (row) => row.title,
      priority: 'primary',
    },
    { key: 'role', label: tr('website.domain.role'), cell: (row) => tr(`website.domain.role.${row.role}`) },
    { key: 'state', label: tr('website.domain.ownership'), cell: state },
    {
      key: 'tls',
      label: tr('website.domain.https'),
      cell: (row) => tr(row.tls === 'ready' ? 'website.domain.tlsReady' : 'website.domain.tlsPending'),
    },
  ]
  return h(Stack, {
    items: [
      h(Notice, {
        title: tr('website.domain.keepOld'),
        message: tr('website.domain.keepOldHelp'),
        tone: 'info',
      }),
      h(DataTable, {
        columns,
        rows: data.rows,
        id: (row) => row.id,
        rowHref: (row) => ctx.href('domains-edit', { id: row.id }),
        emptyTitle: tr('website.domain.empty'),
        emptyMessage: tr('website.domain.emptyHelp'),
      }),
    ],
  })
}
export function createDomainScreens(ctx) {
  const tr = ctx.tr
  const state = (row) => h(Status, { label: tr(`website.domain.state.${row.state}`), tone: tones[row.state] })
  let current
  let primaryId
  let pendingId
  const list = (signal) =>
    ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'domains' }, { signal })
  return {
    domains: {
      read: (_route, signal) => list(signal),
      view: (data) =>
        h(ListPage, {
          variant: 'operational',
          title: tr('website.route.domains'),
          headerActions: h(LinkButton, {
            label: tr('website.domain.add'),
            href: ctx.href('domains-edit', { id: 'new' }),
            variant: 'primary',
          }),
          footer: tr('website.list.results', { count: data.rows.length }),
          body: domainList(ctx, data),
        }),
    },
    'domains-edit': {
      readKey: (route) => route.params.id,
      read: async (route, signal) => {
        const rows = (await list(signal)).rows
        primaryId = rows.find((row) => row.role === 'primary')?.id ?? null
        if (route.params.id === 'new') {
          pendingId ??= newId('domain')
          current = { id: pendingId, revisionId: null }
        } else
          current = await ctx.call(
            'website_studio.getResource',
            { siteId: ctx.site().id, kind: 'domains', id: route.params.id },
            { signal },
          )
        return current
      },
      view: (data) =>
        h(RecordPage, {
          width: 'wide',
          title: data.title ?? tr('website.domain.add'),
          actions: h(LinkButton, { label: tr('website.route.settings'), href: ctx.href('settings') }),
          body: h(Stack, {
            items: [
              h(Surface, {
                title: tr('website.domain.connection'),
                body: data.revisionId
                  ? h(DescriptionList, {
                      items: [
                        { id: 'host', label: tr('website.resource.domains.title'), value: data.title },
                        {
                          id: 'role',
                          label: tr('website.domain.role'),
                          value: tr(`website.domain.role.${data.role}`),
                        },
                        { id: 'ownership', label: tr('website.domain.ownership'), value: state(data) },
                        {
                          id: 'tls',
                          label: tr('website.domain.https'),
                          value: tr(
                            data.tls === 'ready' ? 'website.domain.tlsReady' : 'website.domain.tlsPending',
                          ),
                        },
                        {
                          id: 'checked',
                          label: tr('website.domain.lastChecked'),
                          value: data.checkedAt ?? tr('website.domain.notChecked'),
                        },
                      ],
                    })
                  : html`<form id="domain-create">${h(TextField, { id: 'domain-host', name: 'title', label: tr('website.resource.domains.title'), required: true })}${CommandButton({ label: tr('website.domain.add'), command: 'domain.create', type: 'submit', form: 'domain-create', variant: 'primary', disabled: ctx.busy() })}</form>`,
              }),
              data.revisionId
                ? h(Surface, {
                    title: tr('website.domain.verify'),
                    body: h(Stack, {
                      divided: true,
                      items: [
                        h(Notice, {
                          title: tr('website.domain.simulation'),
                          message: tr('website.domain.simulationHelp'),
                          tone: 'info',
                        }),
                        h(DescriptionList, {
                          items: [
                            {
                              id: 'type',
                              label: tr('website.domain.recordType'),
                              value: data.challenge.type,
                            },
                            {
                              id: 'name',
                              label: tr('website.domain.recordName'),
                              value: data.challenge.name,
                            },
                            {
                              id: 'value',
                              label: tr('website.domain.recordValue'),
                              value: data.challenge.value,
                            },
                          ],
                        }),
                        data.state === 'failed'
                          ? h(Notice, {
                              title: tr('website.domain.failed'),
                              message: tr('website.domain.failedHelp'),
                              tone: 'danger',
                            })
                          : null,
                        html`<form id="domain-verify">${h(TextField, { id: 'domain-proof', name: 'observedTxt', label: tr('website.domain.proof'), help: tr('website.domain.proofHelp') })}${CommandButton({ label: tr('website.domain.check'), command: 'domain.verify', type: 'submit', form: 'domain-verify', variant: 'primary', disabled: ctx.busy() })}</form>`,
                      ],
                    }),
                  })
                : null,
              data.revisionId && data.role !== 'primary'
                ? h(Surface, {
                    title: tr('website.domain.switch'),
                    body: h(Stack, {
                      items: [
                        h(Notice, {
                          title: tr('website.domain.keepOld'),
                          message: tr('website.domain.switchHelp'),
                          tone: 'warning',
                        }),
                        html`<form id="domain-primary">${h(Checkbox, { id: 'domain-confirm', name: 'confirmed', label: tr('website.domain.confirm') })}${CommandButton({ label: tr('website.domain.switch'), command: 'domain.primary', type: 'submit', form: 'domain-primary', disabled: ctx.busy() || data.state !== 'verified' || data.tls !== 'ready' })}</form>`,
                      ],
                    }),
                  })
                : null,
              data.revisionId
                ? h(Surface, {
                    title: tr('website.domain.history'),
                    body: h(DataTable, {
                      rows: data.attempts ?? [],
                      id: (row) => row.id,
                      columns: [
                        { key: 'at', label: tr('website.domain.lastChecked'), cell: (row) => row.at },
                        { key: 'id', label: tr('website.domain.operation'), cell: (row) => row.id },
                        {
                          key: 'result',
                          label: tr('website.domain.ownership'),
                          cell: (row) => state({ state: row.result }),
                        },
                        {
                          key: 'reason',
                          label: tr('website.domain.reason'),
                          cell: (row) =>
                            tr(
                              row.reason === 'matched'
                                ? 'website.domain.matched'
                                : 'website.domain.failedHelp',
                            ),
                        },
                      ],
                      emptyTitle: tr('website.domain.notChecked'),
                      emptyMessage: tr('website.domain.historyHelp'),
                    }),
                  })
                : null,
            ],
          }),
        }),
      commands: {
        'domain.create': async (_args, form) => {
          const row = await ctx.call(
            'website_studio.saveResource',
            {
              kind: 'domains',
              siteId: ctx.site().id,
              id: current.id,
              expectedRevisionId: null,
              values: { title: String(form.get('title') ?? '') },
            },
            { key: current.id },
          )
          pendingId = null
          await ctx.navigate('domains-edit', { id: row.id })
        },
        'domain.verify': async (_args, form) => {
          await ctx.call('website_studio.verifyDomain', {
            siteId: ctx.site().id,
            id: current.id,
            expectedRevisionId: current.revisionId,
            observedTxt: String(form.get('observedTxt') ?? ''),
          })
          await ctx.refresh()
        },
        'domain.primary': async (_args, form) => {
          await ctx.call('website_studio.setPrimaryDomain', {
            siteId: ctx.site().id,
            id: current.id,
            expectedRevisionId: current.revisionId,
            expectedPrimaryId: primaryId,
            confirmed: form.has('confirmed'),
          })
          ctx.notify(tr('website.domain.switched'))
          await ctx.reload()
        },
      },
    },
  }
}
