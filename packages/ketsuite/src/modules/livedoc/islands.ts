import { defineIsland } from '@ketvietlab/ketjs-view'
import { createLiveDocView } from '../../ui/client/live-doc-view.tsx'

type LiveDocProps = { docId: string; base: string; lang?: string }

export const islands = {
  'livedoc.editor': defineIsland<LiveDocProps>()({
    // `base` travels as a prop rather than being derived from the URL: the
    // island is placed by whichever module owns the record, and only that
    // module knows where its document endpoints live.
    props: { docId: 'text', base: 'text', lang: 'text?' },
    key: ['docId'],
    client: 'live-doc.mjs',
    export: 'liveDoc',
    // Server-side render only needs the static shell (view()) — the DOM mount
    // that fetches content and opens the SSE connection happens in the
    // island's own browser entry, since none of fetch/document/EventSource
    // exist in this SSR context.
    view: (props) =>
      createLiveDocView({
        docId: props.docId,
        base: props.base,
        lang: props.lang,
      }),
  }),
}
