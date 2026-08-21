import { each, html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createCrmKanbanView } from './client/crm-kanban-view.mjs'

const runtime = { each, html, signal }

export const kanbanMovePayload = (
  id: string,
  stageId: string,
  expectedVersion: number,
  idempotencyKey: string,
) => ({ id, stageId, expectedVersion, idempotencyKey })

export const islands: Record<string, IslandDefinition> = {
  'crm.pipeline': {
    props: { lang: 'text?', data: 'text?' },
    client: 'crm-kanban.mjs',
    export: 'pipeline',
    view: (props: IslandProps) => createCrmKanbanView(runtime, props),
  },
}
