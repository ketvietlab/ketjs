import { defineModule } from 'ketjs'
import { islands } from './islands.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'crm_backend',
  version: '0.1.0',
  depends: ['crm', 'crm_sale', 'crm_website', 'backend'],
  install: 'auto',
  app: true,
  title: 'CRM',
  summary: 'Lead, opportunity, pipeline and sales activities.',
  category: 'Bán hàng',
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
