import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, dataTable, emptyState, formatDateTime, RecordActions } from '../../../ui/index.ts'
import type { SessionRow } from './types.ts'

export const sessionsScreen = (
  _: Translator,
  rows: readonly SessionRow[],
  actionOf: (row: SessionRow) => string,
): TemplateResult =>
  rows.length === 0
    ? emptyState(_('user_backend.sessions.empty'), _('user_backend.sessions.emptyHint'))
    : dataTable(_, {
        rows,
        id: (row) => row.id,
        columns: [
          {
            key: 'created',
            label: _('user_backend.sessions.created'),
            cell: (row) =>
              formatDateTime(_.locale, new Date(row.createdAt), {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
              }),
          },
          {
            key: 'context',
            label: _('user_backend.sessions.context'),
            cell: (row) => `${row.company ?? '—'} · ${row.branch ?? '—'}`,
          },
          {
            key: 'state',
            label: _('user_backend.field.state'),
            cell: (row) =>
              row.current ? (
                badge(_('user_backend.sessions.current'), 'positive', 'current')
              ) : (
                <RecordActions
                  action={actionOf(row)}
                  actions={[
                    { value: 'revoke', label: _('user_backend.sessions.revoke'), variant: 'destructive' },
                  ]}
                />
              ),
          },
        ],
      })
