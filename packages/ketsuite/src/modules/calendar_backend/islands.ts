import { each, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createCalendarView } from '../../ui/client/calendar-view.mjs'

const runtime = { each, html, signal }
export const islands: Record<string, IslandDefinition> = {
  'calendar.board': {
    props: { lang: 'text?', view: 'text?' },
    client: 'calendar.mjs',
    export: 'board',
    view: (props: IslandProps) => createCalendarView(runtime, props),
  },
}
