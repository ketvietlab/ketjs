import type { Row, Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  contentCard,
  emptyState,
  framedPage as Framed,
  recordForm as RecordForm,
  stack,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export const inboxScreen = (_: Translator, rows: Row[], frame: Frame): TemplateResult => (
  <Framed
    translator={_}
    title={_('mail_backend.inbox.title')}
    frame={frame}
    body={
      rows.length === 0
        ? emptyState(_('mail_backend.inbox.empty'), _('mail_backend.inbox.emptyHint'))
        : stack(
            rows.map((row) =>
              contentCard({
                title: String(row.subject || _('mail_backend.inbox.message')),
                summary: `${String(row.kind)} · ${new Date(String(row.createdAt)).toLocaleString()}`,
                body: String(row.body),
                actions: (
                  <RecordForm
                    action="/admin/inbox"
                    submit={_('mail_backend.inbox.markRead')}
                    submitVariant="secondary"
                    hidden={{ id: String(row.id) }}
                    fields={[]}
                  />
                ),
              }),
            ),
          )
    }
  />
)
