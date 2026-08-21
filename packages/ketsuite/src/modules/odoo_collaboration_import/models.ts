import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Source: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      databaseUuid: 'text',
      odooVersion: 'text',
      lastCursor: 'text?',
      lastImportedAt: 'datetime?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { database: { fields: ['companyId', 'databaseUuid'], unique: true } },
  },

  Run: {
    scope: 'company',
    fields: {
      id: 'id',
      sourceId: 'ref:odoo_collaboration_import.Source',
      mode: 'text',
      state: 'text',
      previousCursor: 'text?',
      cursor: 'text',
      batchChecksum: 'text',
      report: 'json',
      startedAt: 'datetime',
      completedAt: 'datetime?',
      error: 'text?',
    },
    indexes: { source_started: { fields: ['companyId', 'sourceId', 'startedAt', 'id'] } },
  },

  /** Stable, company-scoped identity map. One Odoo row may map to several explicit targets. */
  Map: {
    scope: 'company',
    fields: {
      id: 'id',
      sourceId: 'ref:odoo_collaboration_import.Source',
      sourceModel: 'text',
      sourceRecordId: 'text',
      targetModel: 'text',
      targetId: 'text',
      checksum: 'text',
      firstRunId: 'ref:odoo_collaboration_import.Run',
      lastRunId: 'ref:odoo_collaboration_import.Run',
      importedAt: 'datetime',
    },
    indexes: {
      source_record: {
        fields: ['companyId', 'sourceId', 'sourceModel', 'sourceRecordId', 'targetModel'],
        unique: true,
      },
      target: { fields: ['companyId', 'targetModel', 'targetId'] },
      last_run: { fields: ['companyId', 'lastRunId'] },
    },
  },

  Issue: {
    scope: 'company',
    fields: {
      id: 'id',
      runId: 'ref:odoo_collaboration_import.Run',
      severity: 'text',
      code: 'text',
      sourceModel: 'text',
      sourceRecordId: 'text',
      message: 'text',
      details: 'json?',
      resolved: 'bool',
      createdAt: 'datetime',
    },
    indexes: {
      run_severity: { fields: ['companyId', 'runId', 'severity', 'code', 'id'] },
    },
  },
}
