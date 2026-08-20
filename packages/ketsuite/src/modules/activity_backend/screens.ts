import type { Row, Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  contentCard,
  emptyState,
  formCluster,
  framed,
  inline,
  linkButton,
  recordForm,
  stack,
} from '../../ui/index.ts'
import type { Frame, Tone } from '../../ui/index.ts'

const tone = (state: string): Tone =>
  state === 'overdue' ? 'danger' : state === 'today' ? 'warning' : state === 'done' ? 'positive' : 'neutral'

const targetHref = (row: Row): string | null => {
  if (row.resModel === 'product.Template') return `/admin/products/${String(row.resId)}`
  if (row.resModel === 'stock.Picking') return `/admin/transfers/${String(row.resId)}`
  return null
}

export const activitiesScreen = (
  _: Translator,
  rows: Row[],
  frame: Frame,
  today: string,
  includeDone: boolean,
): TemplateResult =>
  framed(
    _,
    _('activity_backend.title'),
    frame,
    stack([
      inline([
        badge(
          `${rows.filter((row) => row.state === 'overdue').length} ${_('activity_backend.overdue')}`,
          'danger',
        ),
        badge(
          `${rows.filter((row) => row.state === 'today').length} ${_('activity_backend.today')}`,
          'warning',
        ),
        linkButton({
          label: includeDone ? _('activity_backend.hideDone') : _('activity_backend.showDone'),
          href: includeDone ? `/admin/activities?today=${today}` : `/admin/activities?today=${today}&done=1`,
          variant: 'tertiary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('activity_backend.empty'), _('activity_backend.emptyHint'))
        : stack(
            rows.map((row) =>
              contentCard({
                title: String(row.summary),
                href: targetHref(row),
                summary: `${String(row.typeName)} · ${String(row.targetName)} · ${String(row.dueDate)}`,
                meta: badge(
                  _(`activity_backend.state.${String(row.state)}`),
                  tone(String(row.state)),
                  String(row.state),
                ),
                body: row.note ? String(row.note) : undefined,
                actions:
                  row.active === true
                    ? formCluster({
                        forms: [
                          recordForm({
                            action: '/admin/activities',
                            submit: _('activity_backend.complete'),
                            submitVariant: 'primary',
                            layout: 'inline',
                            hidden: { action: 'complete', id: String(row.id), today },
                            fields: [
                              {
                                name: 'feedback',
                                label: _('activity_backend.feedback'),
                                value: '',
                              },
                            ],
                          }),
                          recordForm({
                            action: '/admin/activities',
                            submit: _('activity_backend.reschedule'),
                            submitVariant: 'secondary',
                            layout: 'inline',
                            hidden: { action: 'reschedule', id: String(row.id), today },
                            fields: [
                              {
                                name: 'dueDate',
                                label: _('activity_backend.dueDate'),
                                type: 'date',
                                value: String(row.dueDate),
                                required: true,
                              },
                            ],
                          }),
                          recordForm({
                            action: '/admin/activities',
                            submit: _('activity_backend.cancel'),
                            submitVariant: 'destructive',
                            layout: 'inline',
                            hidden: { action: 'cancel', id: String(row.id), today },
                            fields: [],
                          }),
                        ],
                      })
                    : undefined,
              }),
            ),
          ),
    ]),
  )
