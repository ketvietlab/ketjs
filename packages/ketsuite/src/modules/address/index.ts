import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'address',
  group: 'system',
  version: '0.1.0',
  app: true,
  title: 'Địa chỉ',
  summary: 'Quốc gia, catalog địa giới có phiên bản và định dạng địa chỉ.',
  category: 'Danh bạ',
  models,
  relations,
  functions,
  messages,
})

export { availableCatalogs, loadCatalog } from './loader.ts'
export { divisionPath, resolveAddress, snapshotAddress, validateAddress } from './format.ts'
export type { AddressInput, AddressIssue, ResolvedAddress } from './format.ts'
