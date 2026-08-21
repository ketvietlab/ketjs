import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { jobFunctions, jobs } from './jobs.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'crm',
  version: '0.1.0',
  depends: ['company', 'partner', 'user', 'mail', 'activity', 'calendar'],
  app: true,
  title: 'CRM',
  summary: 'Pipeline bán hàng cho lead và opportunity.',
  category: 'Bán hàng',
  models,
  functions: { ...functions, ...jobFunctions },
  jobs,
  messages,
})

export * from './types.ts'
export { caseWriteEffects, functions } from './functions.ts'
export {
  addCaseMessage,
  addTimeline,
  activeStage,
  actorRequired,
  caseDetail,
  commandKey,
  ensureCrmDefaults,
  firstStage,
  invalid,
  issue,
  n,
  now,
  saveCase,
  serializeCaseList,
} from './operations.ts'
