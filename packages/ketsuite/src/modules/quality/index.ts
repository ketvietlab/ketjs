import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'quality',
  version: '0.1.0',
  depends: ['stock', 'storage', 'user'],
  title: 'Quality',
  summary: 'Immutable inspection templates, evidence and versioned quality decisions.',
  category: 'Inventory',
  models,
  functions,
  messages: {
    vi: { 'app.title': 'Chất lượng', 'app.summary': 'Biểu mẫu và bằng chứng kiểm tra chất lượng.' },
    en: { 'app.title': 'Quality', 'app.summary': 'Quality inspection templates and evidence.' },
  },
})

export { functions as qualityFunctionSpecs }
