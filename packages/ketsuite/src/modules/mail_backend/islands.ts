import { each, html, signal } from 'ketjs-view'
import type { IslandDefinition, IslandProps } from 'ketjs-view'
import { createChatterView, createInboxIndicatorView } from '../../ui/client/mail-view.mjs'

const runtime = { each, html, signal }

export const islands: Record<string, IslandDefinition> = {
  'mail.chatter': {
    props: { resModel: 'text', resId: 'id', lang: 'text?' },
    client: 'mail.mjs',
    export: 'chatter',
    view: (props: IslandProps) => createChatterView(runtime, props),
  },
  'mail.inbox-indicator': {
    props: { lang: 'text?' },
    client: 'mail.mjs',
    export: 'inboxIndicator',
    view: (props: IslandProps) => createInboxIndicatorView(runtime, props),
  },
}
