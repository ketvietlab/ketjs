export interface OdooImportRow {
  model: string
  id: string | number
  values: Record<string, unknown>
}

export interface OdooImportBinding {
  sourceModel: string
  sourceId: string | number
  targetModel: string
  targetId: string
}

export interface OdooImportBatch {
  runId: string
  sourceId: string
  sourceName: string
  databaseUuid: string
  odooVersion: string
  mode: 'snapshot' | 'delta'
  previousCursor?: string
  cursor: string
  bindings?: OdooImportBinding[]
  rows: OdooImportRow[]
}

export interface OdooImportIssue {
  severity: 'warning' | 'error'
  code: string
  sourceModel: string
  sourceRecordId: string
  message: string
  details?: Record<string, unknown>
}

export interface OdooImportCount {
  received: number
  inserted: number
  updated: number
  skipped: number
  unresolved: number
}

export interface OdooImportReport {
  runId: string
  sourceId: string
  mode: 'snapshot' | 'delta'
  cursor: string
  batchChecksum: string
  counts: Record<string, OdooImportCount>
  totals: OdooImportCount
  warnings: number
  errors: number
  timezoneConversions: number
  targets: Array<{ sourceModel: string; sourceId: string; targetModel: string; targetId: string }>
  issues: OdooImportIssue[]
}
