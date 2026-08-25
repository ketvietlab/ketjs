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
    // The screens under a project are reachable only once a project is
    // chosen, so they cannot be menu entries — see the island's own note.
    'backend:nav.items': '{% island "flow.project-nav" %}',
  },
  menus: {
    // A heading rather than a link, the shape every other app root uses: the
    // entry below carries the path, and the sidebar draws it as this app's
    // menu once the reader is inside Flow.
    flow: { label: 'flow_backend.menu.app', icon: 'list', sequence: 45 },
    // First, because it is the screen someone opens to find out what to do
    // today; the project list is where you go to organise, not to work.
    'flow.mine': {
      parent: 'flow',
      label: 'flow_backend.menu.mine',
      path: '/admin/flow/mine',
      sequence: 5,
      needs: 'flow.issue.list',
    },
    'flow.projects': {
      parent: 'flow',
      label: 'flow_backend.menu.projects',
      path: '/admin/flow/projects',
      sequence: 10,
      needs: 'flow.project.list',
    },
  },
})
