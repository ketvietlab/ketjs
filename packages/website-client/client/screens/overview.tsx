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
import { icon } from '../ui.tsx'
import { entryStatus, formatTime, publicationStatus } from './format.ts'
import type { Screen, StudioContext } from '../types.ts'

/** `website_studio.overview`: what needs attention on the selected site. */
export type Overview = {
  counts: { pages: number; changed: number; newSubmissions: number; issues: number }
  live: { state: string; activatedAt: string; activatedBy: string; entryCount: number } | null
  queue: { id: string; type: string; title: string; state: string; updatedAt: string }[]
  submissions: { id: string; formId: string; formTitle: string; summary: string; createdAt: string }[]
  /** What keeps the site from going live: a domain to verify, a submission to resolve. */
  blockers?: { id: string; kind: string; title: string }[]
}

export function createOverview(ctx: StudioContext): Screen<Overview> {
  const muted = (text: string) => <span class="website-overview-meta">{text}</span>
  const tr = ctx.tr
  return {
    read: (_route, signal) =>
      ctx.call<Overview>('website_studio.overview', { siteId: ctx.site().id }, { signal }),
    view: (value) => {
      const site = ctx.site()
      const { counts, live, queue, submissions } = value
      const cards = ctx.slot('overviewCard', value)
      return (
        <WorkspacePage
          title={site.name}
          layout="flow"
          actions={
            site.url ? (
              <LinkButton label={tr('website.overview.openSite')} href={site.url} variant="secondary" />
            ) : null
          }
          body={
            <Stack
              items={[
                ...(value.blockers ?? []).map((r) => (
                  <Notice
                    title={r.title}
                    message={tr(`website.overview.blocker.${r.kind}`)}
                    tone="warning"
                    actions={
                      ctx.can('website.site.manage') ? (
                        <LinkButton
                          label={tr('website.site.resolve')}
                          href={ctx.href(
                            r.kind === 'domain' ? 'domains' : 'submission-detail',
                            r.kind === 'domain' ? {} : { id: r.id },
                          )}
                        />
                      ) : null
                    }
                  />
                )),
                <Grid
                  columns={4}
                  items={[
                    <Metric
                      label={tr('website.overview.metric.pages')}
                      value={counts.pages}
                      icon={icon('file-text')}
                      href={ctx.href('pages')}
                    />,
                    <Metric
                      label={tr('website.overview.metric.changed')}
                      value={counts.changed}
                      tone={counts.changed ? 'warning' : 'neutral'}
                      icon={icon('pencil')}
                      href={ctx.href('pages', {}, { status: 'changed' })}
                    />,
                    <Metric
                      label={tr('website.overview.metric.submissions')}
                      value={counts.newSubmissions}
                      tone={counts.newSubmissions ? 'info' : 'neutral'}
                      icon={icon('mail')}
                      href={ctx.href('forms')}
                    />,
                    <Metric
                      label={tr('website.overview.metric.health')}
                      value={counts.issues}
                      detail={
                        counts.issues
                          ? tr('website.overview.health.issues', { count: counts.issues })
                          : tr('website.overview.health.ok')
                      }
                      tone={counts.issues ? 'danger' : 'positive'}
                      icon={icon(counts.issues ? 'alert-triangle' : 'check-circle')}
                    />,
                  ]}
                />,
                <Surface
                  title={tr('website.overview.live')}
                  actions={
                    <LinkButton
                      label={tr('website.entry.state.published')}
                      href={ctx.href('pages', {}, { status: 'published' })}
                      variant="tertiary"
                    />
                  }
                  body={
                    live ? (
                      <DescriptionList
                        layout="strip"
                        items={[
                          {
                            id: 'state',
                            label: tr('website.publication.state'),
                            value: <Status {...publicationStatus(tr, live.state)} />,
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
                        ]}
                      />
                    ) : (
                      <EmptyState
                        title={tr('website.overview.notLive')}
                        message={tr('website.overview.notLiveMessage')}
                      />
                    )
                  }
                />,
                <Grid
                  columns={2}
                  align="stretch"
                  items={[
                    <Surface
                      title={tr('website.overview.queue')}
                      body={
                        <ResourceList
                          label={tr('website.overview.queue')}
                          rows={queue}
                          id={(row) => row.id}
                          href={(row) =>
                            row.type === 'page'
                              ? ctx.href('builder', { id: row.id })
                              : ctx.href('post-edit', { id: row.id })
                          }
                          primary={(row) => <span class="website-overview-name">{row.title}</span>}
                          secondary={(row) => muted(formatTime(row.updatedAt))}
                          meta={(row) => <Status {...entryStatus(tr, row.state)} />}
                          emptyTitle={tr('website.overview.queueEmpty')}
                          emptyMessage={tr('website.overview.queueEmptyMessage')}
                        />
                      }
                    />,
                    <Surface
                      title={tr('website.overview.submissions')}
                      body={
                        <ResourceList
                          label={tr('website.overview.submissions')}
                          rows={submissions}
                          id={(row) => row.id}
                          href={(row) => ctx.href('submissions', { id: row.formId })}
                          primary={(row) => (
                            <span class="website-overview-name">{row.summary.split(' · ')[0]}</span>
                          )}
                          secondary={(row) =>
                            muted([row.formTitle, ...row.summary.split(' · ').slice(1)].join(' · '))
                          }
                          meta={(row) => muted(formatTime(row.createdAt))}
                          emptyTitle={tr('website.overview.submissionsEmpty')}
                          emptyMessage={tr('website.overview.submissionsEmptyMessage')}
                        />
                      }
                    />,
                  ]}
                />,
                ...cards,
              ]}
            />
          }
        />
      )
    },
  }
}
