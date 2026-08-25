import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { islands } from './islands.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'flow_backend',
  version: '0.1.0',
  depends: ['flow', 'backend', 'user', 'storage', 'livedoc'],
  title: 'Flow',
  summary: 'Projects, boards and issues, with collaborative descriptions.',
  category: 'Productivity',
  // The kit's client directory, the same one mail_backend serves its chatter
  // from: the board and map views are kit files, so they ship from where the
  // kit keeps them rather than being copied into this module. The editor's own
  // stylesheet is livedoc's and loads with that module.
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['flow-app.css'],
  functions,
  routes,
  islands,
  messages,
  joints: {
    'screen.issue': { props: { docId: 'text', base: 'text', lang: 'text?' } },
    // A page's document is the same island under a different base — one joint
    // per screen, because a fill is placed per joint and the two screens do
    // not share a template.
    'screen.page': { props: { docId: 'text', base: 'text', lang: 'text?' } },
    'screen.board': { props: { lang: 'text?', data: 'text?' } },
    'screen.map': { props: { lang: 'text?', data: 'text?' } },
  },
  fills: {
    'flow_backend:screen.issue': '{% island "livedoc.editor" %}',
    'flow_backend:screen.page': '{% island "livedoc.editor" %}',
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
    'flow.board': {
      parent: 'flow',
      label: 'flow_backend.menu.board',
      path: '/admin/flow/board',
      sequence: 15,
      needs: 'flow.issue.list',
    },
    'flow.issues': {
      parent: 'flow',
      label: 'flow_backend.menu.issues',
      path: '/admin/flow/issues',
      sequence: 20,
      needs: 'flow.issue.list',
    },
    'flow.pages': {
      parent: 'flow',
      label: 'flow_backend.menu.pages',
      path: '/admin/flow/pages',
      sequence: 25,
      needs: 'flow.page.list',
    },
  },
})
