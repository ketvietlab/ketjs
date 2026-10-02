import { defineModule } from '@ketvietlab/ketjs'
import { jobs } from './form-delivery.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'crm_website',
  version: '0.1.0',
  // A job must depend directly on every model it writes: creating a lead writes through CRM into
  // partner, activity, calendar, storage and mail, all of which CRM already brings.
  depends: [
    'crm',
    'website',
    'website_form',
    'user',
    'company',
    'partner',
    'activity',
    'calendar',
    'storage',
    'mail',
  ],
  title: 'CRM Website',
  summary: 'Lead capture from the public website, and website forms routed to CRM.',
  category: 'Website',
  models,
  functions,
  jobs,
  routes,
  messages,
})
