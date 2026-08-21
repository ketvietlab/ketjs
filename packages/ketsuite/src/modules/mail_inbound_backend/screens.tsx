import type { Row, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, contentCard, emptyState, framedPage as Framed, inline, stack } from '../../ui/index.ts'
import type { Frame, Tone } from '../../ui/index.ts'

const tone = (state: string): Tone =>
  state === 'processed'
    ? 'positive'
    : state === 'failed'
      ? 'danger'
      : state === 'pending_alias'
        ? 'warning'
        : 'neutral'

export const inboundScreen = (_: Translator, rows: Row[], frame: Frame): TemplateResult => (
  <Framed
    translator={_}
    title={_('mail_inbound_backend.title')}
    frame={frame}
    body={
      rows.length === 0
        ? emptyState(_('mail_inbound_backend.empty'), _('mail_inbound_backend.emptyHint'))
        : stack(
            rows.map((row) =>
              contentCard({
                title: String(row.subject ?? row.providerEventId),
                summary: `${String(row.fromAddress ?? _('mail_inbound_backend.system'))} · ${String(row.provider)}`,
                meta: inline([
                  badge(
                    _(`mail_inbound_backend.state.${String(row.state)}`),
                    tone(String(row.state)),
                    String(row.state),
                  ),
                  badge(String(row.kind), 'neutral'),
                ]),
                body: row.diagnostic
                  ? `${_('mail_inbound_backend.diagnostic')}: ${String(row.diagnostic)}`
                  : row.targetName
                    ? `${_('mail_inbound_backend.target')}: ${String(row.targetName)}`
                    : undefined,
              }),
            ),
          )
    }
  />
)
