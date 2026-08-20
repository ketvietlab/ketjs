import type { Row, Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { contentCard, emptyState, framed, recordForm, stack } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export const inboxScreen = (_: Translator, rows: Row[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('mail_backend.inbox.title'),
    frame,
    rows.length === 0
      ? emptyState(_('mail_backend.inbox.empty'), _('mail_backend.inbox.emptyHint'))
      : stack(
          rows.map((row) =>
            contentCard({
              title: String(row.subject || _('mail_backend.inbox.message')),
              summary: `${String(row.kind)} · ${new Date(String(row.createdAt)).toLocaleString()}`,
              body: String(row.body),
              actions: recordForm({
                action: '/admin/inbox',
                submit: _('mail_backend.inbox.markRead'),
                hidden: { id: String(row.id) },
                fields: [],
              }),
            }),
          ),
        ),
  )
