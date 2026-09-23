import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createFlowBoardView } from '../../ui/client/flow-board-view.mjs'
import { createFlowMapView } from '../../ui/client/flow-map-view.mjs'
import { projectNav } from './screens/index.ts'

const boardRuntime = { each, html, signal }

type FlowDataProps = { lang?: string; data?: string }
type ProjectNavProps = { active: string; lang?: string }

export const islands = {
  'flow.board': defineIsland<FlowDataProps>()({
    props: { lang: 'text?', data: 'text?' },
    client: 'flow-board.mjs',
    export: 'board',
    // No bundling needed here (unlike the editor and mail islands) — this is
    // hand-written vanilla JS with no npm dependency.
    view: (props) => createFlowBoardView(boardRuntime, props),
  }),
  /**
   * Server-rendered only: it is five links, so it carries no `client` module
   * and never hydrates. The shell re-renders it on every navigation, which is
   * also what keeps the marked row correct.
   */
  'flow.project-nav': defineIsland<ProjectNavProps>()({
    props: { active: 'text', lang: 'text?' },
    view: (props) => projectNav(props),
  }),
  'flow.map': defineIsland<FlowDataProps>()({
    props: { lang: 'text?', data: 'text?' },
    client: 'flow-map.mjs',
    export: 'map',
    view: (props) => createFlowMapView(boardRuntime, props),
  }),
}
