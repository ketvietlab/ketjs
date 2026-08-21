import { each, html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createRelationSelectView } from './design/client/relation-select-view.mjs'

const runtime = { each, html, signal }

export const islands: Record<string, IslandDefinition> = {
  'backend.relation-select': {
    props: { id: 'id', config: 'json' },
    key: ['id'],
    client: 'client/relation-select.mjs',
    export: 'relationSelect',
    view: (props: IslandProps) => createRelationSelectView(runtime, props),
  },
}
