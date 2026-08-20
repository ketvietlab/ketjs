import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Template: {
    scope: 'company',
    fields: {
      id: 'id',
      reportId: 'text',
      draft: 'text',
      publishedVersion: 'int',
      revision: 'int',
      layout: 'json',
      updatedAt: 'datetime',
    },
    indexes: { report: { fields: ['companyId', 'reportId'], unique: true } },
  },
  TemplateVersion: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:report.Template',
      version: 'int',
      source: 'text',
      layout: 'json',
      digest: 'text',
      publishedAt: 'datetime',
      publishedBy: 'text?',
    },
    indexes: { template_version: { fields: ['companyId', 'templateId', 'version'], unique: true } },
  },
  Cache: {
    scope: 'company',
    fields: {
      id: 'id',
      reportId: 'text',
      recordId: 'text',
      locale: 'text',
      fingerprint: 'text',
      storageKey: 'text',
      generatedAt: 'datetime',
      expiresAt: 'datetime',
      active: 'bool',
    },
    indexes: { identity: { fields: ['companyId', 'reportId', 'recordId', 'locale'], unique: true } },
  },
}
