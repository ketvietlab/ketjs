import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { jobFunctions, jobs } from './jobs.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'crm',
  group: 'crm',
  version: '0.1.0',
  depends: ['company', 'partner', 'user', 'mail', 'activity', 'calendar'],
  app: true,
  title: 'CRM',
  summary: 'Sales pipeline for leads and opportunities.',
  category: 'Sales',
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
  applyCaseScore,
  canReadCase,
  caseAudience,
  caseDetail,
  closedAtFor,
  commandKey,
  crmActivityType,
  duplicateCases,
  ensureCrmDefaults,
  firstStage,
  gamificationProfile,
  invalid,
  issue,
  n,
  normalized,
  now,
  ownedKinds,
  ownsKind,
  saveCase,
  seededId,
  serializeCaseList,
  stageKinds,
  visibleCases,
} from './operations.ts'
