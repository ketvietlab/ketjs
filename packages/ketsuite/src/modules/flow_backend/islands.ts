import { html } from '@ketvietlab/ketjs-view'
import type { IslandDefinition } from '@ketvietlab/ketjs-view'
import { createIssueEditorView } from './editor-view.ts'

export const islands: Record<string, IslandDefinition> = {
  'flow.issue-editor': {
    props: { issueId: 'text' },
    key: ['issueId'],
    client: 'editor.mjs',
    export: 'default',
    // Server-side render only needs the static shell (view()) — the DOM
    // mount that fetches content and opens the SSE connection is
    // client-only wiring in editor-client.ts, since none of fetch/document/
    // EventSource exist in this SSR context.
    view: (props) => createIssueEditorView({ html }, { issueId: String(props.issueId) }),
  },
}
