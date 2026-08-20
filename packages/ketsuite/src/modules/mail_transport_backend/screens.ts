import type { Row, Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { badge, contentCard, emptyState, framed, inline, recordForm, stack } from '../../ui/index.ts'
import type { Frame, Tone } from '../../ui/index.ts'
import { jsonValue } from '../mail_transport/template.ts'

const tone = (state: string): Tone =>
  state === 'sent'
    ? 'positive'
    : state === 'failed'
      ? 'danger'
      : state === 'retryable'
        ? 'warning'
        : state === 'cancelled'
          ? 'neutral'
          : 'info'

const recipients = (value: unknown): string => {
  const rows = jsonValue<Array<{ address?: string; name?: string }>>(value, [])
  return rows
    .map((row) => (row.name ? `${row.name} <${String(row.address)}>` : String(row.address)))
    .join(', ')
}

export const outboxScreen = (_: Translator, rows: Row[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('mail_transport_backend.title'),
    frame,
    rows.length === 0
      ? emptyState(_('mail_transport_backend.empty'), _('mail_transport_backend.emptyHint'))
      : stack(
          rows.map((row) =>
            contentCard({
              title: String(row.subject),
              summary: `${recipients(row.to)} · ${String(row.templateName ?? _('mail_transport_backend.direct'))}`,
              meta: inline([
                badge(
                  _(`mail_transport_backend.state.${String(row.state)}`),
                  tone(String(row.state)),
                  String(row.state),
                ),
                badge(`${String(row.attempts)} ${_('mail_transport_backend.attempts')}`, 'neutral'),
              ]),
              body: row.lastError
                ? `${_('mail_transport_backend.failure')}: ${String(row.lastError)}`
                : row.targetName
                  ? `${_('mail_transport_backend.target')}: ${String(row.targetName)}`
                  : String(row.text).slice(0, 240),
              actions:
                row.state === 'failed' || row.state === 'retryable'
                  ? recordForm({
                      action: '/admin/outbox',
                      submit: _('mail_transport_backend.retry'),
                      submitVariant: 'secondary',
                      hidden: { action: 'retry', id: String(row.id) },
                      fields: [],
                    })
                  : row.state === 'queued'
                    ? recordForm({
                        action: '/admin/outbox',
                        submit: _('mail_transport_backend.cancel'),
                        submitVariant: 'destructive',
                        hidden: { action: 'cancel', id: String(row.id) },
                        fields: [],
                      })
                    : undefined,
            }),
          ),
        ),
  )
