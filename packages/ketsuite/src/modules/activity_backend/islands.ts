import { each, html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from '../../ui/client/activity-view.mjs'

const runtime = { each, html, signal }

export const islands: Record<string, IslandDefinition> = {
  'activity.record': {
    props: { resModel: 'text', resId: 'id', lang: 'text?' },
    key: ['resModel', 'resId'],
    client: 'activity.mjs',
    export: 'record',
    view: (props: IslandProps) => createRecordActivityView(runtime, props),
  },
  'activity.indicator': {
    props: { lang: 'text?' },
    key: [],
    client: 'activity.mjs',
    export: 'indicator',
    view: (props: IslandProps) => createActivityIndicatorView(runtime, props),
  },
}
