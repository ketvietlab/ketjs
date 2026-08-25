import { each, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { createIssueEditorView } from './editor-view.ts'
import { createFlowBoardView } from '../../ui/client/flow-board-view.mjs'
import { createFlowMapView } from '../../ui/client/flow-map-view.mjs'

const boardRuntime = { each, html, signal }

export const islands: Record<string, IslandDefinition> = {
  'flow.issue-editor': {
    props: { issueId: 'text', lang: 'text?' },
    key: ['issueId'],
    client: 'flow-editor.mjs',
    export: 'default',
    // Server-side render only needs the static shell (view()) — the DOM
    // mount that fetches content and opens the SSE connection is
    // client-only wiring in editor-client.ts, since none of fetch/document/
    // EventSource exist in this SSR context.
    view: (props) =>
      createIssueEditorView(
        { html },
        { issueId: String(props.issueId), lang: props.lang ? String(props.lang) : undefined },
      ),
  },
  'flow.board': {
    props: { lang: 'text?', data: 'text?' },
    client: 'flow-board.mjs',
    export: 'board',
    // No bundling needed here (unlike the editor island above) — this is
    // hand-written vanilla JS with no npm dependency, same as
    // mail_backend's mail.mjs/mail-view.mjs pair.
    view: (props: IslandProps) => createFlowBoardView(boardRuntime, props),
  },
  'flow.map': {
    props: { lang: 'text?', data: 'text?' },
    client: 'flow-map.mjs',
    export: 'map',
    view: (props: IslandProps) => createFlowMapView(boardRuntime, props),
  },
}
