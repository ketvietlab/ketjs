import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createCrmKanbanView } from './client/crm-kanban-view.mjs'

const runtime = { each, html, signal }

export const kanbanMovePayload = (
  id: string,
  stageId: string,
  expectedVersion: number,
  idempotencyKey: string,
) => ({ id, stageId, expectedVersion, idempotencyKey })

type CrmPipelineProps = { lang?: string; data?: string }

export const islands = {
  'crm.pipeline': defineIsland<CrmPipelineProps>()({
    props: { lang: 'text?', data: 'text?' },
    client: 'crm-kanban.mjs',
    export: 'pipeline',
    view: (props) => createCrmKanbanView(runtime, props),
  }),
}
