import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { islands } from './islands.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'flow_backend',
  version: '0.1.0',
  depends: ['flow', 'backend', 'user', 'storage'],
  title: 'Flow',
  summary: 'Real-time collaborative editing for Flow issue descriptions.',
  category: 'Productivity',
  // The kit's client directory, the same one mail_backend serves its chatter
  // from: the editor's shell and stylesheet are kit files, so they ship from
  // where the kit keeps them rather than being copied into this module.
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['flow-editor.css'],
  functions,
  routes,
  islands,
  messages,
  joints: { 'screen.issue': { props: { issueId: 'text', lang: 'text?' } } },
  fills: { 'flow_backend:screen.issue': '{% island "flow.issue-editor" %}' },
  // No menu entry yet — that wants a list/board screen this plan didn't
  // scope (it was about the collaborative editor, not the whole admin UI).
  // The detail screen below is reachable directly at
  // /admin/flow/issues/{id} for now.
})
