import type { Row, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  ContentCard,
  emptyState,
  formatDateTime,
  ListPage,
  RecordForm,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export type InboxScreenOptions = {
  rows: readonly Row[]
  action: string
}

export const inboxScreen = (_: Translator, frame: Frame, options: InboxScreenOptions): TemplateResult =>
  shell(
    _,
    _('mail_backend.inbox.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('mail_backend.inbox.title')}
      description={_('mail_backend.inbox.subtitle')}
      actions={frame.extras?.['topbar.end']}
      status={`${_('mail_backend.inbox.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length === 0
          ? emptyState(_('mail_backend.inbox.empty'), _('mail_backend.inbox.emptyHint'))
          : stack(
              options.rows.map((row) => (
                <ContentCard
                  title={String(row.subject || _('mail_backend.inbox.message'))}
                  summary={`${String(row.kind)} · ${formatDateTime(
                    _.locale,
                    new Date(String(row.createdAt)),
                    {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: 'numeric',
                      second: 'numeric',
                    },
                  )}`}
                  body={String(row.body)}
                  actions={
                    <RecordForm
                      action={options.action}
                      submit={_('mail_backend.inbox.markRead')}
                      submitVariant="secondary"
                      hidden={{ action: 'read', id: String(row.id) }}
                      fields={[]}
                    />
                  }
                />
              )),
            )
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
