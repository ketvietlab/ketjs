import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'storage',
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
})
