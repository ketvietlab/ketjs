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
  // where the kit keeps them rather than being copied into this module. The
  // board and map views follow it here for the same reason.
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['flow-editor.css', 'flow-app.css'],
  functions,
  routes,
  islands,
  messages,
  joints: {
    'screen.issue': { props: { issueId: 'text', lang: 'text?' } },
    'screen.board': { props: { lang: 'text?', data: 'text?' } },
    'screen.map': { props: { lang: 'text?', data: 'text?' } },
  },
  fills: {
    'flow_backend:screen.issue': '{% island "flow.issue-editor" %}',
    'flow_backend:screen.board': '{% island "flow.board" %}',
    'flow_backend:screen.map': '{% island "flow.map" %}',
  },
  menus: {
    flow: {
      label: 'flow_backend.menu.app',
      icon: 'list',
      path: '/admin/flow',
      sequence: 45,
      needs: 'flow.project.list',
    },
  },
})
