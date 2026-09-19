import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { defineRecordModalIsland } from '../../ui/record-modal.tsx'
import { createCrmKanbanView } from './client/crm-kanban-view.mjs'

/**
 * The configuration catalogues open their records in client-side modals (KetSuite
 * record-modal contract). One island per record kind, all bundled into one asset
 * from `modal/configuration-modal-view.tsx`; `backend:runtime` places them.
 */
export const CONFIGURATION_MODAL_ISLANDS = {
  'crm.team-modal': { kind: 'crm.team', export: 'crmTeamModal' },
  'crm.stage-modal': { kind: 'crm.stage', export: 'crmStageModal' },
  'crm.tag-modal': { kind: 'crm.tag', export: 'crmTagModal' },
  'crm.assignment-rule-modal': { kind: 'crm.assignmentRule', export: 'crmAssignmentRuleModal' },
  'crm.score-rule-modal': { kind: 'crm.scoreRule', export: 'crmScoreRuleModal' },
} as const

const configurationModalIslands = Object.fromEntries(
  Object.entries(CONFIGURATION_MODAL_ISLANDS).map(([name, island]) => [
    name,
    defineRecordModalIsland({
      kind: island.kind,
      client: 'crm-configuration-modal.mjs',
      export: island.export,
    }),
  ]),
)

const runtime = { each, html, signal }

export const kanbanMovePayload = (
  id: string,
  stageId: string,
  expectedVersion: number,
  idempotencyKey: string,
) => ({ id, stageId, expectedVersion, idempotencyKey })

type CrmPipelineProps = { lang?: string; data?: string }

export const islands = {
  'crm.case-modal': defineRecordModalIsland({
    kind: 'crm.case',
    client: 'crm-case-modal.mjs',
    export: 'caseModal',
  }),
  'crm.pipeline': defineIsland<CrmPipelineProps>()({
    props: { lang: 'text?', data: 'text?' },
    client: 'crm-kanban.mjs',
    export: 'pipeline',
    view: (props) => createCrmKanbanView(runtime, props),
  }),
  ...configurationModalIslands,
}
