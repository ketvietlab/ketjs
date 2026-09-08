import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from '../../ui/client/activity-view.mjs'

const runtime = { each, html, signal }

type RecordActivityProps = { resModel: string; resId: string; lang?: string }
type IndicatorProps = { lang?: string }

export const islands = {
  'activity.record': defineIsland<RecordActivityProps>()({
    props: { resModel: 'text', resId: 'id', lang: 'text?' },
    key: ['resModel', 'resId'],
    client: 'activity.mjs',
    export: 'record',
    view: (props) => createRecordActivityView(runtime, props),
  }),
  'activity.indicator': defineIsland<IndicatorProps>()({
    props: { lang: 'text?' },
    key: [],
    client: 'activity.mjs',
    export: 'indicator',
    view: (props) => createActivityIndicatorView(runtime, props),
  }),
}
