import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Framed, Gantt, Section } from '../../../ui/index.ts'
import type { Frame, GanttItem } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

/**
 * One project's issues as bars on a day axis.
 *
 * Every issue is placed, because `startsOn` always answers: an issue nobody
 * gave a start date is drawn from the day it was written down, dashed, so a
 * plan read off this chart is not mistaken for a plan somebody made. An issue
 * with no due date is a point rather than a bar reaching to today — it has a
 * day work begins and no day it ends, and drawing one would assert a deadline
 * that does not exist.
 */
export const ganttScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  rows: AnyRow[],
  today: string,
  locale: string,
): TemplateResult => {
  const items: GanttItem[] = rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    href: `/admin/flow/issues/${String(row.id)}`,
    startsOn: row.startsOn ? String(row.startsOn) : null,
    endsOn: row.dueDate ? String(row.dueDate) : null,
    inferredStart: !row.startDate,
    done: row.progress === 100,
    progress: row.progress == null ? null : Number(row.progress),
    detail: [
      String(row.title),
      row.columnName ? String(row.columnName) : null,
      row.assigneeName ? String(row.assigneeName) : _('flow_backend.board.unassigned'),
      row.startDate ? null : _('flow_backend.gantt.inferred'),
    ]
      .filter(Boolean)
      .join(' · '),
  }))
  return (
    <Framed
      translator={_}
      title={projectName}
      frame={frame}
      body={
        <Section
          title={_('flow_backend.gantt.title')}
          description={_('flow_backend.gantt.hint')}
          body={
            <Gantt
              items={items}
              today={today}
              locale={locale}
              labels={{ today: _('flow_backend.gantt.today'), empty: '' }}
              empty={empty(_)}
            />
          }
        />
      }
    />
  )
}
