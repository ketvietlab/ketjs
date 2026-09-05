import { defineModule } from '@ketvietlab/ketjs'
import { islands } from './islands.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'crm_backend',
  version: '0.1.0',
  // The backend renders leads that arrive from the website but never calls into
  // that module; the dependency was pulling a public-site concern into the admin
  // shell for nothing.
  depends: ['crm', 'crm_sale', 'backend', 'stock', 'activity', 'partner', 'user'],
  title: 'CRM',
  summary: 'Lead, opportunity, pipeline and sales activities.',
  category: 'Sales',
  assets: new URL('./client/', import.meta.url),
  styles: ['crm.css'],
  islands,
  joints: { 'screen.pipeline': { props: { lang: 'text?', data: 'text?' } } },
  fills: { 'crm_backend:screen.pipeline': `{% island "crm.pipeline" %}` },
  menus: {
    crm: { label: 'menu.app', icon: 'contact-round', sequence: 18 },
    'crm.pipeline': {
      parent: 'crm',
      label: 'menu.pipeline',
      path: '/admin/crm/pipeline',
      sequence: 10,
      needs: 'crm.case.list',
    },
    'crm.cases': {
      parent: 'crm',
      label: 'menu.cases',
      path: '/admin/crm/cases',
      sequence: 20,
      needs: 'crm.case.list',
    },
    'crm.activities': {
      parent: 'crm',
      label: 'menu.activities',
      path: '/admin/crm/activities',
      sequence: 35,
      needs: 'crm.activity.schedule',
    },
    'crm.leaderboard': {
      parent: 'crm',
      label: 'menu.leaderboard',
      path: '/admin/crm/leaderboard',
      sequence: 50,
      needs: 'crm.gamification.list',
    },
    'crm.configuration': {
      parent: 'crm',
      label: 'menu.configuration',
      path: '/admin/crm/configuration',
      sequence: 90,
      needs: 'crm.configuration.get',
    },
  },
  routes,
  messages,
})

export { islands, kanbanMovePayload } from './islands.ts'
