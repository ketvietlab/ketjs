import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createChatterView, createInboxIndicatorView } from '../../ui/client/mail-view.mjs'

const runtime = { each, html, signal }

type ChatterProps = { resModel: string; resId: string; lang?: string }
type InboxIndicatorProps = { lang?: string }

export const islands = {
  'mail.chatter': defineIsland<ChatterProps>()({
    props: { resModel: 'text', resId: 'id', lang: 'text?' },
    key: ['resModel', 'resId'],
    client: 'mail-bundle.mjs',
    export: 'chatter',
    view: (props) => createChatterView(runtime, props),
  }),
  'mail.inbox-indicator': defineIsland<InboxIndicatorProps>()({
    props: { lang: 'text?' },
    key: [],
    client: 'mail-bundle.mjs',
    export: 'inboxIndicator',
    view: (props) => createInboxIndicatorView(runtime, props),
  }),
}
