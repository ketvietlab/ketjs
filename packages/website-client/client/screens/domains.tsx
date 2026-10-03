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
import { CommandButton } from '../ui.tsx'
import { formatTime, newId } from './format.ts'
import type { Screen, StudioContext, Tone } from '../types.ts'

/** A domain the site answers on; a new one has no revision until it is added. */
export type Domain = {
  id: string
  revisionId: string | null
  title?: string
  role?: string
  state?: string
  tls?: string
  checkedAt?: string | null
  /** What the last check found: matched, missing, mismatch or unreachable. */
  reason?: string | null
  /** The DNS record that proves ownership; a host Két Việt connected before needs none. */
  challenge?: { type: string; name: string; value: string } | null
  attempts?: { id: string; at: string; result: string; reason: string }[]
}
type DomainList = { rows: Domain[] }

const tones: Record<string, Tone> = { verified: 'positive', pending: 'warning', failed: 'danger' }
/** HTTPS follows ownership: Két Việt switches it on once the host is proven. */
const tlsLabel = (row: Pick<Domain, 'state' | 'tls'>) =>
  row.tls === 'ready'
    ? 'website.domain.tlsReady'
    : row.state === 'verified'
      ? 'website.domain.tlsActivating'
      : 'website.domain.tlsPending'
export function domainList(ctx: StudioContext, data: DomainList) {
  const tr = ctx.tr
  const state = (row: Pick<Domain, 'state'>) => (
    <Status label={tr(`website.domain.state.${row.state}`)} tone={tones[row.state ?? '']} />
  )
  const columns = [
    {
      key: 'title',
      label: tr('website.resource.domains.title'),
      cell: (row: Domain) => row.title,
      priority: 'primary' as const,
    },
    {
      key: 'role',
      label: tr('website.domain.role'),
      cell: (row: Domain) => tr(`website.domain.role.${row.role}`),
    },
    { key: 'state', label: tr('website.domain.ownership'), cell: state },
    { key: 'tls', label: tr('website.domain.https'), cell: (row: Domain) => tr(tlsLabel(row)) },
  ]
  return (
    <Stack
      items={[
        <Notice
          title={tr('website.domain.keepOld')}
          message={tr('website.domain.keepOldHelp')}
          tone="info"
        />,
        <DataTable
          columns={columns}
          rows={data.rows}
          id={(row) => row.id}
          rowHref={(row) => ctx.href('domains-edit', { id: row.id })}
          emptyTitle={tr('website.domain.empty')}
          emptyMessage={tr('website.domain.emptyHelp')}
        />,
      ]}
    />
  )
}
export function createDomainScreens(ctx: StudioContext) {
  const tr = ctx.tr
  const state = (row: Pick<Domain, 'state'>) => (
    <Status label={tr(`website.domain.state.${row.state}`)} tone={tones[row.state ?? '']} />
  )
  let current: Domain
  let primaryId: string | null
  let pendingId: string | null = null
  const list = (signal: AbortSignal) =>
    ctx.call<DomainList>(
      'website_studio.listResources',
      { siteId: ctx.site().id, kind: 'domains' },
      { signal },
    )
  return {
    domains: {
      read: (_route, signal) => list(signal),
      view: (data) => (
        <ListPage
          variant="operational"
          title={tr('website.route.domains')}
          headerActions={
            <LinkButton
              label={tr('website.domain.add')}
              href={ctx.href('domains-edit', { id: 'new' })}
              variant="primary"
            />
          }
          footer={tr('website.list.results', { count: data.rows.length })}
          body={domainList(ctx, data)}
        />
      ),
    } satisfies Screen<DomainList>,
    'domains-edit': {
      readKey: (route) => route.params.id,
      read: async (route, signal) => {
        const rows = (await list(signal)).rows
        primaryId = rows.find((row) => row.role === 'primary')?.id ?? null
        if (route.params.id === 'new') {
          pendingId ??= newId('domain')
          current = { id: pendingId, revisionId: null }
        } else
          current = await ctx.call<Domain>(
            'website_studio.getResource',
            { siteId: ctx.site().id, kind: 'domains', id: route.params.id },
            { signal },
          )
        return current
      },
      view: (data) => (
        <RecordPage
          width="wide"
          title={data.title ?? tr('website.domain.add')}
          actions={<LinkButton label={tr('website.route.settings')} href={ctx.href('settings')} />}
          body={
            <Stack
              items={[
                <Surface
                  title={tr('website.domain.connection')}
                  body={
                    data.revisionId ? (
                      <DescriptionList
                        items={[
                          {
                            id: 'host',
                            label: tr('website.resource.domains.title'),
                            value: data.title ?? '',
                          },
                          {
                            id: 'role',
                            label: tr('website.domain.role'),
                            value: tr(`website.domain.role.${data.role}`),
                          },
                          { id: 'ownership', label: tr('website.domain.ownership'), value: state(data) },
                          {
                            id: 'tls',
                            label: tr('website.domain.https'),
                            value: tr(tlsLabel(data)),
                          },
                          {
                            id: 'checked',
                            label: tr('website.domain.lastChecked'),
                            value: data.checkedAt
                              ? formatTime(data.checkedAt)
                              : tr('website.domain.notChecked'),
                          },
                        ]}
                      />
                    ) : (
                      <form id="domain-create">
                        <TextField
                          id="domain-host"
                          name="title"
                          label={tr('website.resource.domains.title')}
                          required
                        />
                        <CommandButton
                          label={tr('website.domain.add')}
                          command="domain.create"
                          type="submit"
                          form="domain-create"
                          variant="primary"
                          disabled={ctx.busy()}
                        />
                      </form>
                    )
                  }
                />,
                data.revisionId && data.challenge ? (
                  <Surface
                    title={tr('website.domain.verify')}
                    body={
                      <Stack
                        divided
                        items={[
                          <Notice
                            title={tr('website.domain.howTo')}
                            message={tr('website.domain.howToHelp')}
                            tone="info"
                          />,
                          <DescriptionList
                            items={[
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
                            ]}
                          />,
                          data.state === 'failed' ? (
                            <Notice
                              title={tr('website.domain.failed')}
                              message={tr(`website.domain.reason.${data.reason}`)}
                              tone="danger"
                            />
                          ) : null,
                          data.state === 'verified' ? null : (
                            <CommandButton
                              label={tr('website.domain.check')}
                              command="domain.verify"
                              variant="primary"
                              disabled={ctx.busy()}
                            />
                          ),
                        ]}
                      />
                    }
                  />
                ) : null,
                data.revisionId && data.role !== 'primary' ? (
                  <Surface
                    title={tr('website.domain.switch')}
                    body={
                      <Stack
                        items={[
                          <Notice
                            title={tr('website.domain.keepOld')}
                            message={tr('website.domain.switchHelp')}
                            tone="warning"
                          />,
                          <form id="domain-primary">
                            <Checkbox
                              id="domain-confirm"
                              name="confirmed"
                              label={tr('website.domain.confirm')}
                            />
                            <CommandButton
                              label={tr('website.domain.switch')}
                              command="domain.primary"
                              type="submit"
                              form="domain-primary"
                              disabled={ctx.busy() || data.state !== 'verified' || data.tls !== 'ready'}
                            />
                          </form>,
                        ]}
                      />
                    }
                  />
                ) : null,
                data.revisionId ? (
                  <Surface
                    title={tr('website.domain.history')}
                    body={
                      <DataTable
                        rows={data.attempts ?? []}
                        id={(row) => row.id}
                        columns={[
                          {
                            key: 'at',
                            label: tr('website.domain.lastChecked'),
                            cell: (row) => formatTime(row.at),
                            kind: 'date',
                          },
                          {
                            key: 'result',
                            label: tr('website.domain.ownership'),
                            cell: (row) => state({ state: row.result }),
                          },
                          {
                            key: 'reason',
                            label: tr('website.domain.reason'),
                            cell: (row) => tr(`website.domain.reason.${row.reason}`),
                          },
                        ]}
                        emptyTitle={tr('website.domain.notChecked')}
                        emptyMessage={tr('website.domain.historyHelp')}
                      />
                    }
                  />
                ) : null,
              ]}
            />
          }
        />
      ),
      commands: {
        'domain.create': async (_args, form) => {
          const row = await ctx.call<Domain>(
            'website_studio.saveResource',
            {
              kind: 'domains',
              siteId: ctx.site().id,
              id: current.id,
              expectedRevisionId: null,
              values: { title: String(form!.get('title') ?? '') },
            },
            { key: current.id },
          )
          pendingId = null
          await ctx.navigate('domains-edit', { id: row.id })
        },
        'domain.verify': async () => {
          await ctx.call('website_studio.verifyDomain', {
            siteId: ctx.site().id,
            id: current.id,
            expectedRevisionId: current.revisionId,
          })
          await ctx.refresh()
        },
        'domain.primary': async (_args, form) => {
          await ctx.call('website_studio.setPrimaryDomain', {
            siteId: ctx.site().id,
            id: current.id,
            expectedRevisionId: current.revisionId,
            expectedPrimaryId: primaryId,
            confirmed: form!.has('confirmed'),
          })
          ctx.notify(tr('website.domain.switched'))
          await ctx.reload()
        },
      },
    } satisfies Screen<Domain>,
  }
}
