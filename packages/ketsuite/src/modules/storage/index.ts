import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'storage',
  group: 'system',
  version: '0.1.0',
  depends: ['company'],
  app: true,
  title: 'Tệp tin',
  summary: 'Tệp đính kèm trên đĩa hoặc dịch vụ tương thích S3.',
  category: 'Hệ thống',
  models,
  functions,
  jobs,
  routes,
  messages: {
    vi: {
      'app.title': 'Tệp tin',
      'app.summary': 'Tệp đính kèm trên đĩa hoặc dịch vụ tương thích S3.',
      'app.category': 'Hệ thống',
    },
    en: {
      'app.title': 'Files',
      'app.summary': 'Attachments on local disk or an S3-compatible service.',
      'app.category': 'System',
    },
  },
})
