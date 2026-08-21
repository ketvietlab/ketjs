import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { reportRoute } from './routes.ts'

export default defineModule({
  name: 'report',
  version: '0.1.0',
  install: 'auto',
  title: 'Report engine',
  summary: 'Versioned KTL templates, synchronous PDF rendering, and a 30-day artifact cache.',
  category: 'Hệ thống',
  models,
  functions,
  jobs,
  routes: { '/reports/{report}/{id}': reportRoute },
  messages: {
    vi: { 'app.title': 'Báo cáo', 'app.summary': 'Mẫu in và bộ máy PDF.' },
    en: { 'app.title': 'Reports', 'app.summary': 'Print templates and the PDF engine.' },
  },
})
