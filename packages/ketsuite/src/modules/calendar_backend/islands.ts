import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createCalendarView } from '../../ui/client/calendar-view.mjs'

const runtime = { each, html, signal }
type CalendarProps = { lang?: string; view?: string }

export const islands = {
  'calendar.board': defineIsland<CalendarProps>()({
    props: { lang: 'text?', view: 'text?' },
    client: 'calendar.mjs',
    export: 'board',
    view: (props) => createCalendarView(runtime, props),
  }),
}
