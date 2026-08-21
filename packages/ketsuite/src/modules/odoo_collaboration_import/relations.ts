import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'odoo_collaboration_import.Source': {
    runs: { hasMany: 'odoo_collaboration_import.Run', by: 'sourceId' },
    maps: { hasMany: 'odoo_collaboration_import.Map', by: 'sourceId' },
  },
  'odoo_collaboration_import.Run': {
    source: { belongsTo: 'odoo_collaboration_import.Source', by: 'sourceId' },
    issues: { hasMany: 'odoo_collaboration_import.Issue', by: 'runId' },
  },
  'odoo_collaboration_import.Map': {
    source: { belongsTo: 'odoo_collaboration_import.Source', by: 'sourceId' },
    firstRun: { belongsTo: 'odoo_collaboration_import.Run', by: 'firstRunId' },
    lastRun: { belongsTo: 'odoo_collaboration_import.Run', by: 'lastRunId' },
  },
  'odoo_collaboration_import.Issue': {
    run: { belongsTo: 'odoo_collaboration_import.Run', by: 'runId' },
  },
}
