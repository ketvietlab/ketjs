import type { Row, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, ContentCard, emptyState, inline, ListPage, shell, stack } from '../../../ui/index.ts'
import type { Frame, Tone } from '../../../ui/index.ts'

export type InboundScreenOptions = {
  rows: readonly Row[]
}

const tone = (state: string): Tone =>
  state === 'processed'
    ? 'positive'
    : state === 'failed'
      ? 'danger'
      : state === 'pending_alias'
        ? 'warning'
        : 'neutral'

export const inboundScreen = (
  _: Translator,
  frame: Frame,
  options: InboundScreenOptions,
): TemplateResult =>
  shell(
    _,
    _('mail_inbound_backend.title'),
    <ListPage
      title={_('mail_inbound_backend.title')}
      description={_('mail_inbound_backend.subtitle')}
      actions={frame.extras?.['topbar.end']}
      status={`${_('mail_inbound_backend.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length === 0
          ? emptyState(_('mail_inbound_backend.empty'), _('mail_inbound_backend.emptyHint'))
          : stack(
              options.rows.map((row) => (
                <ContentCard
                  title={String(row.subject ?? row.providerEventId)}
                  summary={`${String(row.fromAddress ?? _('mail_inbound_backend.system'))} · ${String(row.provider)}`}
                  meta={inline([
                    badge(
                      _(`mail_inbound_backend.state.${String(row.state)}`),
                      tone(String(row.state)),
                      String(row.state),
                    ),
                    badge(String(row.kind), 'neutral'),
                  ])}
                  body={
                    row.diagnostic
                      ? `${_('mail_inbound_backend.diagnostic')}: ${String(row.diagnostic)}`
                      : row.targetName
                        ? `${_('mail_inbound_backend.target')}: ${String(row.targetName)}`
                        : undefined
                  }
                />
              )),
            )
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
